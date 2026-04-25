const CASH = new Set(['CASH','RUB','MNYMKT','MM','ДЕНЬГИ']);
const MFD_NAMES = {
  SBER:['Сбербанк','SBER'], SBERP:['Сбербанк-п','SBERP'], GAZP:['ГАЗПРОМ ао','GAZP'], LKOH:['ЛУКОЙЛ','LKOH'],
  GMKN:['ГМКНорНик','GMKN'], NVTK:['Новатэк ао','NVTK'], TATN:['Татнфт 3ао','TATN'], VTBR:['ВТБ ао','VTBR'],
  RUAL:['РУСАЛ','RUAL'], AFLT:['Аэрофлот','AFLT'], MOEX:['МосБиржа','MOEX'], YDEX:['Яндекс','YDEX'], YNDX:['Яндекс','YNDX'],
  ROSN:['Роснефть','ROSN'], CHMF:['СевСт-ао','CHMF'], NLMK:['НЛМК ао','NLMK'], MAGN:['ММК','MAGN'], MTSS:['МТС-ао','MTSS'],
  IRAO:['ИнтерРАОао','IRAO'], HYDR:['РусГидро','HYDR'], SNGS:['Сургнфгз','SNGS'], SNGSP:['Сургнфгз-п','SNGSP']
};
const BOARD_CANDIDATES = [
  ['stock','shares','TQBR'], ['stock','shares','TQTF'], ['stock','shares','TQTD'], ['stock','shares','TQPI'], ['stock','shares','TQIF'],
  ['stock','bonds','TQCB'], ['stock','index','SNDX']
];
function ymdToDMY(s){ const [y,m,d]=s.split('-'); return `${d}.${m}.${y}`; }
function parseNum(v){ if(v==null||v==='') return null; if(typeof v==='number') return Number.isFinite(v)?v:null; const n=Number(String(v).replace(/\s/g,'').replace(',','.')); return Number.isFinite(n)?n:null; }
function pct(a,b){ return a&&b ? (b/a-1) : null; }
async function fetchJson(url){ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AVC Parser'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
function tableRows(json, name='history'){
  const t=json[name]; if(!t||!t.columns||!t.data) return [];
  return t.data.map(row=>Object.fromEntries(t.columns.map((c,i)=>[c,row[i]])));
}
async function fetchMoexTicker(ticker, from, to){
  const sec = encodeURIComponent(ticker);
  let lastErr = '';
  for(const [engine, market, board] of BOARD_CANDIDATES){
    let start=0, out=[];
    for(let guard=0; guard<40; guard++){
      const url=`https://iss.moex.com/iss/history/engines/${engine}/markets/${market}/boards/${board}/securities/${sec}.json?iss.meta=off&from=${from}&till=${to}&start=${start}`;
      try{
        const json=await fetchJson(url); const rows=tableRows(json,'history');
        if(!rows.length) break;
        for(const r of rows){
          const close=parseNum(r.CLOSE ?? r.LEGALCLOSEPRICE ?? r.WAPRICE ?? r.MARKETPRICE3);
          if(r.TRADEDATE && close!=null) out.push({date:r.TRADEDATE, close, source:'MOEX', board});
        }
        if(rows.length<100) break; start += rows.length;
      } catch(e){ lastErr=e.message; break; }
    }
    if(out.length) return out.sort((a,b)=>a.date.localeCompare(b.date));
  }
  throw new Error(lastErr || 'MOEX: данные не найдены');
}
async function fetchMfdTicker(ticker, from, to){
  // MFD export uses internal ticker registry. This function tries common request variants.
  const names = MFD_NAMES[ticker] || [ticker];
  const paramsBase = {
    Alias:'false', Period:'1', timeframeValue:'1', timeframeDatePart:'day', StartDate:ymdToDMY(from), EndDate:ymdToDMY(to),
    SaveFormat:'0', SaveMode:'0', FieldSeparator:',', DecimalSeparator:'.', DateFormat:'yyyy-MM-dd', TimeFormat:'HH:mm', AddHeader:'true', RecordFormat:'0', Fill:'false'
  };
  const groups = ['16','26','1','0'];
  const tries=[];
  for(const group of groups){ for(const name of names){
    const p = new URLSearchParams({...paramsBase, TickerGroup:group, Tickers:name});
    tries.push(`https://mfd.ru/export/handler.ashx?${p.toString()}`);
  }}
  let lastText='';
  for(const url of tries){
    try{
      const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AVC Parser','Accept':'text/csv,text/plain,*/*'}});
      const text=await r.text(); lastText=text.slice(0,120);
      if(!r.ok || !text || /DOCTYPE|html|Ошибка|error/i.test(text.slice(0,500))) continue;
      const lines=text.trim().split(/\r?\n/).filter(Boolean);
      const out=[];
      for(const line of lines){
        if(/^TICKER/i.test(line)) continue;
        const parts=line.split(/[;,\t]/).map(x=>x.trim().replace(/^"|"$/g,''));
        // TICKER,PER,DATE,TIME,OPEN,HIGH,LOW,CLOSE,VOL,OPENINT
        const date=parts[2]; const close=parseNum(parts[7] ?? parts[6] ?? parts[4]);
        if(/^\d{4}-\d{2}-\d{2}$/.test(date) && close!=null) out.push({date, close, source:'MFD'});
      }
      if(out.length) return out.sort((a,b)=>a.date.localeCompare(b.date));
    }catch(e){ lastText=e.message; }
  }
  throw new Error(`MFD: данные не найдены${lastText ? ' / '+lastText : ''}`);
}
function buildRows(seriesByTicker, tickers, from, to){
  const allDates=[...new Set(Object.values(seriesByTicker).flatMap(s=>s.map(x=>x.date)))].sort();
  const priceMap={}; for(const t of tickers){ priceMap[t]=new Map((seriesByTicker[t]||[]).map(x=>[x.date,x.close])); }
  const prev={}; const rows=[];
  for(const date of allDates){ const row={Date:date}; let any=false;
    for(const t of tickers){
      if(CASH.has(t)){ row[t]=0; any=true; continue; }
      const close=priceMap[t]?.get(date);
      if(close!=null){ row[t]=prev[t] ? pct(prev[t],close) : null; prev[t]=close; any=true; } else row[t]=null;
    }
    if(any) rows.push(row);
  }
  return rows;
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const q=req.query || {}; const tickers=String(q.tickers||'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
  const from=String(q.from||'2020-01-01'); const to=String(q.to||new Date().toISOString().slice(0,10));
  const source=String(q.source||'auto').toLowerCase();
  if(!tickers.length) return res.status(400).json({error:'Введите тикеры'});
  const seriesByTicker={}, errors=[], meta=[];
  for(const t of tickers){
    if(CASH.has(t)){ seriesByTicker[t]=[{date:from,close:1,source:'CASH'},{date:to,close:1,source:'CASH'}]; meta.push({ticker:t,source:'CASH'}); continue; }
    try{
      let data=null;
      if(source==='mfd') data=await fetchMfdTicker(t,from,to);
      else if(source==='moex') data=await fetchMoexTicker(t,from,to);
      else { try{ data=await fetchMfdTicker(t,from,to); } catch(e){ data=await fetchMoexTicker(t,from,to); } }
      seriesByTicker[t]=data; meta.push({ticker:t, source:data[0]?.source, board:data[0]?.board||'', points:data.length});
    }catch(e){ seriesByTicker[t]=[]; errors.push(`${t}: ${e.message}`); }
  }
  const rows=buildRows(seriesByTicker,tickers,from,to);
  res.status(200).json({tickers, from, to, rows, meta, errors});
}
