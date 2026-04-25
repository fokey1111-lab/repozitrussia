const BASE = 'https://iss.moex.com/iss';
const BOARDS = ['TQBR','TQTF','TQTD','TQIF','TQPI','TQBD','TQOB','TQCB','TQIR'];
const MARKETS = ['shares','foreignshares','bonds'];
const CASH = new Set(['CASH','RUB','MNYMKT','MM','MONEY']);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function timeoutSignal(ms){ const c = new AbortController(); setTimeout(()=>c.abort(), ms); return c.signal; }
function tableToObjects(tbl){
  if(!tbl || !Array.isArray(tbl.columns) || !Array.isArray(tbl.data)) return [];
  return tbl.data.map(row => Object.fromEntries(tbl.columns.map((c,i)=>[c,row[i]])));
}
async function getJson(url, ms=12000){
  const r = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0'}, signal: timeoutSignal(ms) });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchHistory(secid, market, board, from, till){
  let all = [];
  let start = 0;
  while(true){
    const url = `${BASE}/history/engines/stock/markets/${market}/boards/${board}/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=history&history.columns=TRADEDATE,SECID,CLOSE,LEGALCLOSEPRICE,WAPRICE,BOARDID&from=${from}&till=${till}&start=${start}`;
    const json = await getJson(url);
    const rows = tableToObjects(json.history);
    const valid = rows.filter(x => x.TRADEDATE && (x.CLOSE ?? x.LEGALCLOSEPRICE ?? x.WAPRICE) != null);
    all.push(...valid);
    if(rows.length < 100) break;
    start += 100;
    await sleep(80);
    if(start > 20000) break;
  }
  return all;
}
async function findCandidates(secid){
  const out = [];
  try{
    const url = `${BASE}/securities/${encodeURIComponent(secid)}.json?iss.meta=off`;
    const json = await getJson(url, 10000);
    const boards = tableToObjects(json.boards).filter(b => b.is_traded === 1 || b.is_traded === '1' || b.IS_TRADED === 1);
    for(const b of boards){
      const board = b.boardid || b.BOARDID;
      const market = b.market || b.MARKET || 'shares';
      const engine = b.engine || b.ENGINE || 'stock';
      if(engine === 'stock' && board) out.push({market, board});
    }
  }catch(e){}
  for(const market of MARKETS) for(const board of BOARDS) out.push({market, board});
  const seen = new Set();
  return out.filter(c => { const k = `${c.market}:${c.board}`; if(seen.has(k)) return false; seen.add(k); return true; });
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method === 'OPTIONS') return res.status(200).end();
  const q = req.query || {};
  const tickerRaw = String(q.ticker || '').trim().toUpperCase();
  const ticker = tickerRaw === 'YNDX' ? 'YDEX' : tickerRaw;
  const from = String(q.from || '2024-01-01');
  const till = String(q.till || new Date().toISOString().slice(0,10));
  if(!ticker) return res.status(400).json({ok:false,error:'Не указан ticker'});
  if(CASH.has(ticker)) return res.status(200).json({ok:true,ticker,board:'CASH',market:'cash',rows:[]});
  try{
    const candidates = await findCandidates(ticker);
    const errors = [];
    for(const c of candidates){
      try{
        const rows = await fetchHistory(ticker, c.market, c.board, from, till);
        if(rows.length){
          const cleaned = rows.map(r => ({
            date: r.TRADEDATE,
            close: Number(r.CLOSE ?? r.LEGALCLOSEPRICE ?? r.WAPRICE),
            board: r.BOARDID || c.board
          })).filter(r=>Number.isFinite(r.close)).sort((a,b)=>a.date.localeCompare(b.date));
          if(cleaned.length) return res.status(200).json({ok:true,ticker,requested:tickerRaw,board:c.board,market:c.market,rows:cleaned});
        }
      }catch(e){ errors.push(`${c.market}/${c.board}: ${e.message}`); }
    }
    return res.status(200).json({ok:false,ticker,requested:tickerRaw,error:`Данные не найдены. Проверены boards: ${candidates.map(c=>c.board).slice(0,12).join(', ')}`,details:errors.slice(0,5)});
  }catch(e){
    return res.status(200).json({ok:false,ticker,requested:tickerRaw,error:e.message || 'Ошибка загрузки'});
  }
}
