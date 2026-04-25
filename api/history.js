function toUnix(date, endOfDay = false) {
  const suffix = endOfDay ? 'T23:59:59Z' : 'T00:00:00Z';
  return Math.floor(new Date(`${date}${suffix}`).getTime() / 1000);
}

function toYmd(date) {
  return String(date || '').replaceAll('-', '');
}

function parseStooqCsv(text) {
  if (!text || /^No data/i.test(text.trim())) return [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return {
      date: row.Date,
      open: Number(row.Open),
      high: Number(row.High),
      low: Number(row.Low),
      close: Number(row.Close),
      volume: Number(row.Volume || 0),
    };
  }).filter((r) => r.date && Number.isFinite(r.close));
}

async function loadFromYahoo(ticker, start, end) {
  const period1 = toUnix(start, false);
  const period2 = toUnix(end, true);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history%7Cdiv%7Csplit&includeAdjustedClose=true`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 ETF Daily Parser' },
  });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  if (!timestamps.length) return [];

  return timestamps.map((ts, i) => {
    const close = Number(adj[i] ?? quote.close?.[i]);
    return {
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: Number(quote.open?.[i]),
      high: Number(quote.high?.[i]),
      low: Number(quote.low?.[i]),
      close,
      volume: Number(quote.volume?.[i] || 0),
    };
  }).filter((r) => r.date && Number.isFinite(r.close));
}

async function loadFromStooq(ticker, start, end) {
  const symbol = `${ticker.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${toYmd(start)}&d2=${toYmd(end)}&i=d`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 ETF Daily Parser' },
  });
  if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
  return parseStooqCsv(await response.text());
}

export default async function handler(req, res) {
  try {
    const { tickers = '', start = '', end = '' } = req.query;
    const list = [...new Set(tickers.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))];

    if (!list.length) return res.status(400).json({ error: 'Введите хотя бы один тикер.' });
    if (!start || !end) return res.status(400).json({ error: 'Введите дату начала и дату окончания.' });
    if (new Date(start) > new Date(end)) return res.status(400).json({ error: 'Дата начала позже даты окончания.' });

    const result = {};
    const errors = [];

    await Promise.all(list.map(async (ticker) => {
      if (ticker === 'MNYMKT') {
        result[ticker] = [];
        return;
      }

      try {
        let rows = await loadFromYahoo(ticker, start, end);
        if (!rows.length) rows = await loadFromStooq(ticker, start, end);
        result[ticker] = rows;
        if (!rows.length) errors.push(`${ticker}: данные не найдены`);
      } catch (firstError) {
        try {
          const rows = await loadFromStooq(ticker, start, end);
          result[ticker] = rows;
          if (!rows.length) errors.push(`${ticker}: данные не найдены`);
        } catch (secondError) {
          result[ticker] = [];
          errors.push(`${ticker}: ошибка загрузки (${firstError.message})`);
        }
      }
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ data: result, errors });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Ошибка загрузки данных.' });
  }
}
