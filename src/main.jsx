import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Loader2, Search, TrendingUp, BarChart3 } from 'lucide-react';
import './styles.css';

const defaultTickers = 'SBER, GAZP, LKOH, YNDX, MGNT, NVTK, ROSN, TATN, VTBR, AFLT, MOEX, GMKN, POLY, RUAL, CASH';

function formatPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  return `${(x * 100).toFixed(2)}%`;
}

function formatNum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  return Number(x).toFixed(4);
}

function safeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function makeDateRange(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (d <= last) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function buildDailyRows(rawData, tickers, start, end) {
  const byTicker = {};
  tickers.forEach((ticker) => {
    byTicker[ticker] = new Map((rawData[ticker] || []).map((r) => [r.date, r]));
  });

  const datesFromMarket = new Set();
  Object.values(rawData).forEach((rows) => rows.forEach((r) => datesFromMarket.add(r.date)));
  const dates = datesFromMarket.size ? Array.from(datesFromMarket).sort() : makeDateRange(start, end);

  const prevClose = {};
  const rows = [];

  dates.forEach((date) => {
    const row = { date };
    const dayReturns = [];

    tickers.forEach((ticker) => {
      if (ticker === 'MNYMKT' || ticker === 'CASH' || ticker === 'RUB') {
        row[`${ticker}_close`] = 1;
        row[`${ticker}_return`] = 0;
        dayReturns.push({ ticker, value: 0 });
        return;
      }

      const item = byTicker[ticker]?.get(date);
      if (!item) {
        row[`${ticker}_close`] = null;
        row[`${ticker}_return`] = null;
        return;
      }

      row[`${ticker}_close`] = item.close;
      const ret = prevClose[ticker] ? item.close / prevClose[ticker] - 1 : null;
      row[`${ticker}_return`] = ret;
      prevClose[ticker] = item.close;
      if (ret !== null) dayReturns.push({ ticker, value: ret });
    });

    const valid = dayReturns.filter((x) => x.value !== null && !Number.isNaN(x.value));
    row.avgReturn = valid.length ? valid.reduce((s, x) => s + x.value, 0) / valid.length : null;
    row.best = valid.length ? valid.reduce((a, b) => (b.value > a.value ? b : a)) : null;
    row.worst = valid.length ? valid.reduce((a, b) => (b.value < a.value ? b : a)) : null;
    rows.push(row);
  });

  return rows;
}

function toReturnsCsv(rows, tickers) {
  const headers = ['Date', ...tickers.map((t) => `${t} Daily Return`), 'Average Daily Return', 'Best Asset', 'Best Return', 'Worst Asset', 'Worst Return'];
  const lines = [headers.map(safeCsvCell).join(',')];

  rows.forEach((r) => {
    const cells = [r.date];
    tickers.forEach((t) => cells.push(r[`${t}_return`] === null || r[`${t}_return`] === undefined ? '' : (r[`${t}_return`] * 100).toFixed(4) + '%'));
    cells.push(
      r.avgReturn === null || r.avgReturn === undefined ? '' : (r.avgReturn * 100).toFixed(4) + '%',
      r.best?.ticker ?? '',
      r.best?.value === null || r.best?.value === undefined ? '' : (r.best.value * 100).toFixed(4) + '%',
      r.worst?.ticker ?? '',
      r.worst?.value === null || r.worst?.value === undefined ? '' : (r.worst.value * 100).toFixed(4) + '%'
    );
    lines.push(cells.map(safeCsvCell).join(','));
  });
  return lines.join('\n');
}

function toAnalyticsCsv(summary) {
  const headers = ['Ticker', 'Trading Days', 'Total Return', 'Annualized Return', 'Annualized Volatility', 'Max Drawdown', 'Positive Days', 'Best Day', 'Worst Day'];
  const lines = [headers.join(',')];
  summary.forEach((s) => {
    lines.push([
      s.ticker,
      s.days,
      s.total === null ? '' : (s.total * 100).toFixed(4) + '%',
      s.cagr === null ? '' : (s.cagr * 100).toFixed(4) + '%',
      s.vol === null ? '' : (s.vol * 100).toFixed(4) + '%',
      s.maxDrawdown === null ? '' : (s.maxDrawdown * 100).toFixed(4) + '%',
      s.positiveDays === null ? '' : (s.positiveDays * 100).toFixed(4) + '%',
      s.bestDay === null ? '' : (s.bestDay * 100).toFixed(4) + '%',
      s.worstDay === null ? '' : (s.worstDay * 100).toFixed(4) + '%',
    ].map(safeCsvCell).join(','));
  });
  return lines.join('\n');
}

function calcSummary(rows, tickers) {
  return tickers.map((ticker) => {
    const rets = rows.map((r) => r[`${ticker}_return`]).filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
    const closes = rows.map((r) => r[`${ticker}_close`]).filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
    const total = closes.length > 1 ? closes.at(-1) / closes[0] - 1 : (ticker === 'MNYMKT' || ticker === 'CASH' || ticker === 'RUB') ? 0 : null;
    const days = closes.length;
    const cagr = total !== null && days > 1 ? Math.pow(1 + total, 252 / Math.max(days - 1, 1)) - 1 : null;
    const avg = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : null;
    const variance = rets.length > 1 ? rets.reduce((s, x) => s + Math.pow(x - avg, 2), 0) / (rets.length - 1) : null;
    const vol = variance !== null ? Math.sqrt(variance) * Math.sqrt(252) : null;
    const positiveDays = rets.length ? rets.filter((x) => x > 0).length / rets.length : null;
    const bestDay = rets.length ? Math.max(...rets) : null;
    const worstDay = rets.length ? Math.min(...rets) : null;

    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    rets.forEach((r) => {
      equity *= 1 + r;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    });

    return { ticker, days, total, cagr, vol, maxDrawdown: rets.length ? maxDrawdown : null, positiveDays, bestDay, worstDay };
  });
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function App() {
  const today = new Date().toISOString().slice(0, 10);
  const [tickersText, setTickersText] = useState(defaultTickers);
  const [start, setStart] = useState('2024-01-01');
  const [end, setEnd] = useState(today);
  const [rawData, setRawData] = useState({});
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const tickers = useMemo(() => [...new Set(tickersText.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))], [tickersText]);
  const hasData = useMemo(() => Object.values(rawData).some((items) => Array.isArray(items) && items.length > 0) || tickers.some((t) => ['MNYMKT','CASH','RUB'].includes(t)), [rawData, tickers]);
  const rows = useMemo(() => hasData ? buildDailyRows(rawData, tickers, start, end) : [], [rawData, tickers, start, end, hasData]);
  const summary = useMemo(() => calcSummary(rows, tickers), [rows, tickers]);

  async function loadData() {
    setLoading(true);
    setMessage('');
    setErrors([]);
    try {
      const qs = new URLSearchParams({ tickers: tickers.join(','), start, end });
      const response = await fetch(`/api/history?${qs.toString()}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Ошибка загрузки данных');
      setRawData(json.data || {});
      setErrors(json.errors || []);
      const loadedTickers = Object.entries(json.data || {}).filter(([t, arr]) => ['MNYMKT','CASH','RUB'].includes(t) || (Array.isArray(arr) && arr.length)).length;
      const tableRows = buildDailyRows(json.data || {}, tickers, start, end).length;
      setMessage(`Загружено российских активов с данными: ${loadedTickers} из ${tickers.length}. Строк в таблице: ${tableRows}. CSV скачивается только с Daily Return.`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadDailyReturns() {
    downloadFile(`daily-returns-${start}-${end}.csv`, toReturnsCsv(rows, tickers));
  }

  function downloadAnalytics() {
    downloadFile(`analytics-summary-${start}-${end}.csv`, toAnalyticsCsv(summary));
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="eyebrow"><TrendingUp size={18} /> MOEX Daily Parser PRO</div>
          <h1>Автоматический парсинг российских активов MOEX</h1>
          <p>Введите тикеры российских акций и фондов, диапазон дат — сайт загрузит дневные данные с MOEX ISS и рассчитает Daily Return, CAGR, волатильность, максимальную просадку и статистику.</p>
        </div>
      </section>

      <section className="panel controls">
        <label>
          Тикеры через запятую
          <textarea value={tickersText} onChange={(e) => setTickersText(e.target.value)} rows={4} />
        </label>
        <div className="grid2">
          <label>Дата начала<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Дата окончания<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <div className="actions">
          <button onClick={loadData} disabled={loading}>{loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />} Загрузить данные</button>
          <button className="secondary" onClick={downloadDailyReturns} disabled={!rows.length}><Download size={18} /> Скачать Daily Return CSV</button>
          <button className="secondary" onClick={downloadAnalytics} disabled={!rows.length}><BarChart3 size={18} /> Скачать аналитику CSV</button>
        </div>
        {message && <div className="message">{message}</div>}
        {errors.length > 0 && <div className="warning">{errors.join(' • ')}</div>}
      </section>

      <section className="panel tableWrap">
        <h2>Сводная аналитика</h2>
        <div className="tableScroll short">
          {rows.length === 0 ? <div className="empty">Нажмите «Загрузить данные».</div> : <table>
            <thead>
              <tr>
                <th>Тикер</th><th>Дней</th><th>Итого</th><th>CAGR</th><th>Волатильность</th><th>Max Drawdown</th><th>Положит. дней</th><th>Лучший день</th><th>Худший день</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.ticker}>
                  <td>{s.ticker}</td><td>{s.days}</td><td>{formatPct(s.total)}</td><td>{formatPct(s.cagr)}</td><td>{formatPct(s.vol)}</td><td>{formatPct(s.maxDrawdown)}</td><td>{formatPct(s.positiveDays)}</td><td>{formatPct(s.bestDay)}</td><td>{formatPct(s.worstDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>}
        </div>
      </section>

      <section className="panel tableWrap">
        <h2>Ежедневная статистика — Daily Return</h2>
        <div className="tableScroll">
          {rows.length === 0 ? <div className="empty">Нажмите «Загрузить данные». Если после загрузки таблица пустая — проверьте тикеры и диапазон дат.</div> : <table>
            <thead>
              <tr>
                <th>Дата</th>
                {tickers.map((t) => <th key={t}>{t} Daily Return</th>)}
                <th>Средняя</th><th>Лучший</th><th>Худший</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice().reverse().map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  {tickers.map((t) => <td key={t}>{formatPct(r[`${t}_return`])}</td>)}
                  <td>{formatPct(r.avgReturn)}</td>
                  <td>{r.best ? `${r.best.ticker} ${formatPct(r.best.value)}` : ''}</td>
                  <td>{r.worst ? `${r.worst.ticker} ${formatPct(r.worst.value)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>}
        </div>
      </section>

      <section className="panel tableWrap">
        <h2>Контроль цен</h2>
        <div className="tableScroll short">
          {rows.length === 0 ? <div className="empty">Цены появятся после загрузки данных.</div> : <table>
            <thead>
              <tr><th>Дата</th>{tickers.map((t) => <th key={t}>{t} цена</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice().reverse().map((r) => (
                <tr key={r.date}><td>{r.date}</td>{tickers.map((t) => <td key={t}>{formatNum(r[`${t}_close`])}</td>)}</tr>
              ))}
            </tbody>
          </table>}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
