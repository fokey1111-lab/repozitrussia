import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const DEFAULT_TICKERS = 'SBER, LKOH, GAZP, TATN, GMKN, VTBR, RUAL, AFLT, NVTK, MOEX, YDEX, CASH';

function parseTickers(text) {
  return [...new Set(text.split(/[ ,;\n\t]+/).map(x => x.trim().toUpperCase()).filter(Boolean))];
}
function pct(x) { return x == null || !Number.isFinite(x) ? '' : (x * 100).toFixed(2) + '%'; }
function csvEscape(v) { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replaceAll('"','""') + '"' : s; }

function App() {
  const today = new Date().toISOString().slice(0,10);
  const [tickersText, setTickersText] = useState(DEFAULT_TICKERS);
  const [from, setFrom] = useState('2024-01-01');
  const [till, setTill] = useState(today);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [series, setSeries] = useState({});
  const abortRef = useRef(null);

  const tickers = useMemo(() => parseTickers(tickersText), [tickersText]);

  async function loadTicker(ticker, signal) {
    if (['CASH','RUB','MNYMKT'].includes(ticker)) return { ticker, rows: [], board: 'CASH' };
    const url = `/api/moex-history?ticker=${encodeURIComponent(ticker)}&from=${from}&till=${till}`;
    const r = await fetch(url, { signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  async function loadAll() {
    setLoading(true); setLogs([]); setSeries({});
    const controller = new AbortController(); abortRef.current = controller;
    const nextSeries = {};
    for (const ticker of tickers) {
      if (controller.signal.aborted) break;
      setLogs(prev => [...prev, `⏳ ${ticker}: загрузка...`]);
      try {
        const result = await loadTicker(ticker, controller.signal);
        nextSeries[ticker] = result.rows || [];
        setSeries({ ...nextSeries });
        const count = result.rows?.length || 0;
        setLogs(prev => [...prev.filter(x => x !== `⏳ ${ticker}: загрузка...`), `✅ ${ticker}: ${count ? count + ' дней, board ' + result.board : 'кэш 0%'}`]);
      } catch (e) {
        setLogs(prev => [...prev.filter(x => x !== `⏳ ${ticker}: загрузка...`), `❌ ${ticker}: ${e.message}`]);
      }
    }
    setLoading(false);
  }
  function stop() { abortRef.current?.abort(); setLoading(false); setLogs(prev => [...prev, '⛔ загрузка остановлена']); }

  const returnsTable = useMemo(() => {
    const dates = new Set();
    const returnsByTicker = {};
    for (const ticker of tickers) {
      const rows = series[ticker] || [];
      returnsByTicker[ticker] = {};
      if (['CASH','RUB','MNYMKT'].includes(ticker)) continue;
      for (let i = 1; i < rows.length; i++) {
        const ret = rows[i-1].close ? rows[i].close / rows[i-1].close - 1 : null;
        returnsByTicker[ticker][rows[i].date] = ret;
        dates.add(rows[i].date);
      }
    }
    const sorted = [...dates].sort();
    return sorted.map(date => {
      const row = { Date: date };
      for (const ticker of tickers) {
        row[ticker] = ['CASH','RUB','MNYMKT'].includes(ticker) ? 0 : (returnsByTicker[ticker]?.[date] ?? null);
      }
      return row;
    });
  }, [series, tickers]);

  function downloadReturns() {
    if (!returnsTable.length) return;
    const header = ['Date', ...tickers];
    const lines = [header.join(';')];
    for (const row of returnsTable) lines.push(header.map(h => h === 'Date' ? row.Date : pct(row[h])).map(csvEscape).join(';'));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `daily_returns_moex_${from}_${till}.csv`; a.click();
  }

  return <div className="page">
    <header><div><h1>Парсер российских активов</h1><p>Источник: серверный API MOEX ISS без CORS-зависаний. Экспорт — только Daily Return.</p></div></header>
    <section className="card controls">
      <label>Тикеры<textarea value={tickersText} onChange={e=>setTickersText(e.target.value)} /></label>
      <div className="dates"><label>С даты<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>По дату<input type="date" value={till} onChange={e=>setTill(e.target.value)} /></label></div>
      <div className="buttons"><button disabled={loading} onClick={loadAll}>{loading ? 'Загрузка...' : 'Загрузить Daily Return'}</button><button onClick={stop} disabled={!loading} className="secondary">Остановить</button><button onClick={downloadReturns} disabled={!returnsTable.length} className="secondary">Скачать CSV Daily Return</button></div>
    </section>
    <section className="grid">
      <div className="card"><h2>Статус</h2><div className="log">{logs.map((l,i)=><div key={i}>{l}</div>)}</div></div>
      <div className="card"><h2>Итог</h2><p>Тикеров: <b>{tickers.length}</b></p><p>Строк Daily Return: <b>{returnsTable.length}</b></p><p>Загружено активов: <b>{Object.keys(series).length}</b></p></div>
    </section>
    <section className="card"><h2>Daily Return</h2><div className="tableWrap"><table><thead><tr><th>Date</th>{tickers.map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{returnsTable.slice(-300).map(r=><tr key={r.Date}><td>{r.Date}</td>{tickers.map(t=><td key={t}>{pct(r[t])}</td>)}</tr>)}</tbody></table></div></section>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
