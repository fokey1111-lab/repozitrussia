import React, {useMemo, useState} from 'react';
import { createRoot } from 'react-dom/client';
import { Download, RefreshCw, AlertTriangle } from 'lucide-react';
import './style.css';

const CASH = new Set(['CASH','RUB','MNYMKT','ДЕНЬГИ']);
const DEFAULT_TICKERS = 'VTBR, RUAL, MOEX, YDEX, TATN, GAZP, SBER, LKOH, GMKN, AFLT, NVTK, CASH';
const BOARDS = ['TQBR','TQTF','TQTD','TQPI','TQIF','TQOB'];

function fmtDate(d){ return d.toISOString().slice(0,10); }
function pct(x){ return x == null || Number.isNaN(x) ? '' : (x*100).toFixed(2)+'%'; }
function num(x){ return x == null || Number.isNaN(x) ? '' : Number(x).toFixed(4); }
function normalizeTickers(s){ return [...new Set(s.split(/[;,\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean))]; }

async function getJson(url){
  const r = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
function tableRows(block){
  if(!block || !block.columns || !block.data) return [];
  return block.data.map(row => Object.fromEntries(block.columns.map((c,i)=>[c,row[i]])));
}

async function findSecurity(secid){
  // 1) Быстрый прямой поиск по основным board
  for(const board of BOARDS){
    try{
      const url = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/${board}/securities/${secid}.json?iss.meta=off&securities.columns=SECID,SHORTNAME,BOARDID`;
      const j = await getJson(url);
      const rows = tableRows(j.securities);
      if(rows.some(r => String(r.SECID).toUpperCase() === secid)) return {secid, board};
    }catch(e){}
  }
  // 2) Глобальный поиск: помогает для переименованных/нестандартных бумаг
  try{
    const url = `https://iss.moex.com/iss/securities.json?q=${encodeURIComponent(secid)}&iss.meta=off&securities.columns=secid,shortname,group,is_traded`;
    const j = await getJson(url);
    const rows = tableRows(j.securities);
    const exact = rows.find(r => String(r.secid).toUpperCase() === secid && Number(r.is_traded) === 1) || rows.find(r => String(r.secid).toUpperCase() === secid);
    if(exact) return {secid: String(exact.secid).toUpperCase(), board:'TQBR'};
  }catch(e){}
  return null;
}

async function loadMoexHistory(secid, from, till){
  const found = await findSecurity(secid);
  if(!found) throw new Error('бумага не найдена на MOEX ISS');
  let out = [];
  let start = 0;
  while(true){
    const url = `https://iss.moex.com/iss/history/engines/stock/markets/shares/boards/${found.board}/securities/${found.secid}.json?from=${from}&till=${till}&start=${start}&iss.meta=off&history.columns=TRADEDATE,LEGALCLOSEPRICE,CLOSE,ADMITTEDQUOTE,WAPRICE`;
    const j = await getJson(url);
    const rows = tableRows(j.history).map(r => ({
      date: r.TRADEDATE,
      close: Number(r.LEGALCLOSEPRICE ?? r.CLOSE ?? r.ADMITTEDQUOTE ?? r.WAPRICE)
    })).filter(r => r.date && Number.isFinite(r.close) && r.close > 0);
    out.push(...rows);
    if(rows.length < 100) break;
    start += 100;
    if(start > 20000) break;
  }
  if(out.length === 0) throw new Error(`данные не найдены на board ${found.board}`);
  out.sort((a,b)=>a.date.localeCompare(b.date));
  return {ticker:secid, board:found.board, rows:out};
}

function buildTables(seriesMap, tickers){
  const dates = [...new Set(Object.values(seriesMap).flatMap(s => s.rows.map(r=>r.date)))].sort();
  const priceRows = [];
  const returnRows = [];
  const prev = {};
  const priceByTickerDate = {};
  for(const t of tickers){ priceByTickerDate[t] = new Map((seriesMap[t]?.rows||[]).map(r=>[r.date,r.close])); }
  for(const date of dates){
    const pr = {Date:date};
    const rr = {Date:date};
    for(const t of tickers){
      if(CASH.has(t)){ pr[t]=1; rr[t]=0; continue; }
      const p = priceByTickerDate[t]?.get(date);
      pr[t] = p ?? null;
      rr[t] = p != null && prev[t] != null ? p/prev[t]-1 : null;
      if(p != null) prev[t]=p;
    }
    priceRows.push(pr); returnRows.push(rr);
  }
  return {priceRows: priceRows.reverse(), returnRows: returnRows.reverse()};
}

function downloadCSV(rows, tickers, filename, returnsOnly=true){
  if(!rows.length) return;
  const headers = ['Date', ...tickers];
  const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => {
    const v = r[h];
    if(h==='Date') return v;
    return returnsOnly ? pct(v) : num(v);
  }).join(','))).join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

function App(){
  const today = new Date();
  const [tickersText,setTickersText]=useState(DEFAULT_TICKERS);
  const [from,setFrom]=useState('2024-04-01');
  const [till,setTill]=useState(fmtDate(today));
  const [loading,setLoading]=useState(false);
  const [errors,setErrors]=useState([]);
  const [loaded,setLoaded]=useState([]);
  const [prices,setPrices]=useState([]);
  const [returns,setReturns]=useState([]);
  const tickers = useMemo(()=>normalizeTickers(tickersText),[tickersText]);
  async function run(){
    setLoading(true); setErrors([]); setLoaded([]); setPrices([]); setReturns([]);
    const seriesMap = {}; const ok=[]; const bad=[];
    for(const t of tickers){
      if(CASH.has(t)){ seriesMap[t] = {rows:[]}; ok.push(`${t}: кэш 0%`); continue; }
      try{ const s = await loadMoexHistory(t, from, till); seriesMap[t]=s; ok.push(`${t}: ${s.rows.length} дней, ${s.board}`); }
      catch(e){ bad.push(`${t}: ${e.message}`); }
    }
    const active = tickers.filter(t => seriesMap[t]);
    const built = buildTables(seriesMap, active);
    setLoaded(ok); setErrors(bad); setPrices(built.priceRows); setReturns(built.returnRows); setLoading(false);
  }
  const stats = useMemo(()=> tickers.filter(t=>returns.some(r=>r[t]!=null)).map(t=>{
    const vals = returns.map(r=>r[t]).filter(v=>v!=null);
    const avg = vals.reduce((a,b)=>a+b,0)/Math.max(vals.length,1);
    const pos = vals.filter(v=>v>0).length;
    return {t, days:vals.length, avg, posRate: vals.length?pos/vals.length:null};
  }),[returns,tickers]);
  const visibleTickers = tickers.filter(t=>returns.some(r=>r[t]!=null));
  return <div className="page">
    <div className="hero"><h1>MOEX Daily Return Parser PRO</h1><p>Парсинг российских акций/фондов напрямую с MOEX ISS. Yahoo здесь не используется.</p></div>
    <div className="panel grid">
      <label>Тикеры MOEX<textarea value={tickersText} onChange={e=>setTickersText(e.target.value)} /></label>
      <label>Дата начала<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
      <label>Дата окончания<input type="date" value={till} onChange={e=>setTill(e.target.value)} /></label>
      <button onClick={run} disabled={loading}>{loading?<RefreshCw className="spin"/>:<RefreshCw/>} Загрузить данные</button>
    </div>
    <div className="actions">
      <button onClick={()=>downloadCSV(returns, visibleTickers, 'moex_daily_returns.csv', true)} disabled={!returns.length}><Download/> Скачать только Daily Return</button>
      <button onClick={()=>downloadCSV(prices, visibleTickers, 'moex_daily_prices.csv', false)} disabled={!prices.length}><Download/> Скачать Prices</button>
    </div>
    {errors.length>0 && <div className="warn"><AlertTriangle/> <div>{errors.map((e,i)=><div key={i}>{e}</div>)}<p>Важно: YNDX больше не основной тикер. Используйте YDEX. POLY может отсутствовать в стандартном TQBR после изменений листинга.</p></div></div>}
    {loaded.length>0 && <div className="ok">{loaded.join(' • ')}</div>}
    {stats.length>0 && <div className="cards">{stats.map(s=><div className="card" key={s.t}><b>{s.t}</b><span>Дней: {s.days}</span><span>Средн. день: {pct(s.avg)}</span><span>Положит.: {pct(s.posRate)}</span></div>)}</div>}
    <section><h2>Ежедневная статистика — Daily Return</h2><div className="tablewrap"><table><thead><tr><th>Дата</th>{visibleTickers.map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{returns.map((r,i)=><tr key={i}><td>{r.Date}</td>{visibleTickers.map(t=><td className={(r[t]||0)>=0?'pos':'neg'} key={t}>{pct(r[t])}</td>)}</tr>)}</tbody></table></div></section>
    <section><h2>Контрольная таблица — Prices</h2><div className="tablewrap small"><table><thead><tr><th>Дата</th>{visibleTickers.map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{prices.map((r,i)=><tr key={i}><td>{r.Date}</td>{visibleTickers.map(t=><td key={t}>{num(r[t])}</td>)}</tr>)}</tbody></table></div></section>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
