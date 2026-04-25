const CASH = new Set(['CASH','RUB','MNYMKT','MM','ДЕНЬГИ']);

const BOARD_CANDIDATES = [
  ['stock','shares','TQBR'], ['stock','shares','TQTF'], ['stock','shares','TQTD'], ['stock','shares','TQPI'], ['stock','shares','TQIF'],
  ['stock','bonds','TQCB'], ['stock','index','SNDX']
];

const MFD_NAMES = {
  SBER:['SBER','Сбербанк'], SBERP:['SBERP','Сбербанк-п'], GAZP:['GAZP','ГАЗПРОМ ао'], LKOH:['LKOH','ЛУКОЙЛ'],
  GMKN:['GMKN','ГМКНорНик'], NVTK:['NVTK','Новатэк ао'], TATN:['TATN','Татнфт 3ао'], VTBR:['VTBR','ВТБ ао'],
  RUAL:['RUAL','РУСАЛ'], AFLT:['AFLT','Аэрофлот'], MOEX:['MOEX','МосБиржа'], YDEX:['YDEX','Яндекс'], YNDX:['YNDX','Яндекс'],
  ROSN:['ROSN','Роснефть'], CHMF:['CHMF','СевСт-ао'], NLMK:['NLMK','НЛМК ао'], MAGN:['MAGN','ММК'], MTSS:['MTSS','МТС-ао'],
  IRAO:['IRAO','ИнтерРАОао'], HYDR:['HYDR','РусГидро'], SNGS:['SNGS','Сургнфгз'], SNGSP:['SNGSP','Сургнфгз-п']
};

function parseNum(v){
  if(v == null || v === '') return null;
  if(typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n) ? n : null;
}
function pct(a,b){ return a && b ? (b/a - 1) : null; }
function ymdToDMY(s){ const [y,m,d] = s.split('-'); return `${d}.${m}.${y}`; }

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000){
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try{
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 AVC Parser',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(id);
  }
}

async function fetchJson(url, timeoutMs = 8000){
  const r = await fetchWithTimeout(url, { headers:{ Accept:'application/json' } }, timeoutMs);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function tableRows(json, name='history'){
  const t = json[name];
  if(!t || !t.columns || !t.data) return [];
  return t.data.map(row => Object.fromEntries(t.columns.map((c,i)=>[c,row[i]])));
}

async function fetchMoexTicker(ticker, from, to){
  const sec = encodeURIComponent(ticker === 'YNDX' ? 'YDEX' : ticker);
  let lastErr = '';
  for(const [engine, market, board] of BOARD_CANDIDATES){
    let start = 0;
    const out = [];
    for(let guard = 0; guard < 25; guard++){
      const url = `https://iss.moex.com/iss/history/engines/${engine}/markets/${market}/boards/${board}/securities/${sec}.json?iss.meta=off&from=${from}&till=${to}&start=${start}`;
      try{
        const json = await fetchJson(url, 7000);
        const rows = tableRows(json, 'history');
        if(!rows.length) break;
        for(const r of rows){
          const close = parseNum(r.CLOSE ?? r.LEGALCLOSEPRICE ?? r.WAPRICE ?? r.MARKETPRICE3);
          if(r.TRADEDATE && close != null) out.push({ date:r.TRADEDATE, close, source:'MOEX', board });
        }
        if(rows.length < 100) break;
        start += rows.length;
      }catch(e){
        lastErr = e.name === 'AbortError' ? 'MOEX timeout' : e.message;
        break;
      }
    }
    if(out.length) return out.sort((a,b)=>a.date.localeCompare(b.date));
  }
  throw new Error(lastErr || 'MOEX: данные не найдены');
}

async function fetchMfdTicker(ticker, from, to){
  const names = MFD_NAMES[ticker] || [ticker];
  const base = {
    Alias:'false', Period:'1', timeframeValue:'1', timeframeDatePart:'day',
    StartDate:ymdToDMY(from), EndDate:ymdToDMY(to), SaveFormat:'0', SaveMode:'0',
    FieldSeparator:',', DecimalSeparator:'.', DateFormat:'yyyy-MM-dd', TimeFormat:'HH:mm',
    AddHeader:'true', RecordFormat:'0', Fill:'false'
  };
  // Важно: не делаем десятки долгих попыток. 2 группы x 2 имени = максимум 4 быстрые попытки.
  const groups = ['16','1'];
  let last = '';
  for(const group of groups){
    for(const name of names.slice(0,2)){
      const p = new URLSearchParams({ ...base, TickerGroup:group, Tickers:name });
      const url = `https://mfd.ru/export/handler.ashx?${p.toString()}`;
      try{
        const r = await fetchWithTimeout(url, { headers:{ Accept:'text/csv,text/plain,*/*' } }, 5000);
        const text = await r.text();
        last = text.slice(0,100).replace(/\s+/g,' ');
        if(!r.ok || !text || /DOCTYPE|html|Ошибка|error/i.test(text.slice(0,500))) continue;
        const lines = text.trim().split(/\r?\n/).filter(Boolean);
        const out = [];
        for(const line of lines){
          if(/^TICKER/i.test(line)) continue;
          const parts = line.split(/[;,\t]/).map(x=>x.trim().replace(/^"|"$/g,''));
          const date = parts[2];
          const close = parseNum(parts[7] ?? parts[6] ?? parts[4]);
          if(/^\d{4}-\d{2}-\d{2}$/.test(date) && close != null) out.push({ date, close, source:'MFD' });
        }
        if(out.length) return out.sort((a,b)=>a.date.localeCompare(b.date));
      }catch(e){
        last = e.name === 'AbortError' ? 'MFD timeout' : e.message;
      }
    }
  }
  throw new Error(`MFD: нет данных или таймаут${last ? ' / '+last : ''}`);
}

function buildRows(seriesByTicker, tickers){
  const allDates = [...new Set(Object.values(seriesByTicker).flatMap(s => s.map(x => x.date)))].sort();
  const priceMap = {};
  for(const t of tickers) priceMap[t] = new Map((seriesByTicker[t] || []).map(x => [x.date, x.close]));
  const prev = {};
  const rows = [];
  for(const date of allDates){
    const row = { Date: date };
    let any = false;
    for(const t of tickers){
      if(CASH.has(t)){ row[t] = 0; any = true; continue; }
      const close = priceMap[t]?.get(date);
      if(close != null){ row[t] = prev[t] ? pct(prev[t], close) : null; prev[t] = close; any = true; }
      else row[t] = null;
    }
    if(any) rows.push(row);
  }
  return rows;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  const q = req.query || {};
  const tickers = String(q.tickers || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0,40);
  const from = String(q.from || '2020-01-01');
  const to = String(q.to || new Date().toISOString().slice(0,10));
  const source = String(q.source || 'auto').toLowerCase();
  if(!tickers.length) return res.status(400).json({ error:'Введите тикеры' });

  const seriesByTicker = {}, errors = [], meta = [];
  // Последовательно, чтобы не упереться в лимиты источников. Но каждый тикер имеет таймаут.
  for(const t of tickers){
    if(CASH.has(t)){
      seriesByTicker[t] = [{date:from, close:1, source:'CASH'}, {date:to, close:1, source:'CASH'}];
      meta.push({ ticker:t, source:'CASH', points:2 });
      continue;
    }
    try{
      let data;
      if(source === 'mfd') data = await fetchMfdTicker(t, from, to);
      else if(source === 'moex') data = await fetchMoexTicker(t, from, to);
      else {
        // Auto: сначала быстрый MOEX как более стабильный, потом MFD как fallback.
        try { data = await fetchMoexTicker(t, from, to); }
        catch(moexErr) {
          try { data = await fetchMfdTicker(t, from, to); }
          catch(mfdErr) { throw new Error(`${moexErr.message}; ${mfdErr.message}`); }
        }
      }
      seriesByTicker[t] = data;
      meta.push({ ticker:t, source:data[0]?.source || '', board:data[0]?.board || '', points:data.length });
    }catch(e){
      seriesByTicker[t] = [];
      errors.push(`${t}: ${e.message}`);
      meta.push({ ticker:t, source:'ERROR', points:0 });
    }
  }
  const rows = buildRows(seriesByTicker, tickers);
  return res.status(200).json({ tickers, from, to, rows, meta, errors });
}
