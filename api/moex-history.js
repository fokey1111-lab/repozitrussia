const BOARDS = ["TQBR", "TQTF", "TQTD", "TQTE", "TQPI", "TQIF", "TQOB", "TQOD", "TQCB"];
const ENGINE = "stock";
const MARKET = "shares";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.end(JSON.stringify(body));
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 russian-parser/1.0" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function blockRows(json, name) {
  const b = json?.[name];
  if (!b || !Array.isArray(b.columns) || !Array.isArray(b.data)) return [];
  return b.data.map(row => Object.fromEntries(b.columns.map((c, i) => [c, row[i]])));
}

async function loadBoard(secid) {
  // Сначала пробуем популярные board без лишнего поиска — это быстрее.
  for (const board of BOARDS) {
    const url = `https://iss.moex.com/iss/history/engines/${ENGINE}/markets/${MARKET}/boards/${board}/securities/${encodeURIComponent(secid)}.json?iss.meta=off&from=2024-01-01&till=2024-01-15&history.columns=TRADEDATE,CLOSE,WAPRICE,LEGALCLOSEPRICE`;
    try {
      const json = await fetchJson(url, 7000);
      const rows = blockRows(json, "history");
      if (rows.length) return board;
    } catch (_) {}
  }
  return null;
}

async function loadHistory(secid, board, from, till) {
  let start = 0;
  const out = [];
  for (let page = 0; page < 80; page++) {
    const url = `https://iss.moex.com/iss/history/engines/${ENGINE}/markets/${MARKET}/boards/${board}/securities/${encodeURIComponent(secid)}.json?iss.meta=off&from=${from}&till=${till}&start=${start}&history.columns=TRADEDATE,CLOSE,WAPRICE,LEGALCLOSEPRICE`;
    const json = await fetchJson(url, 12000);
    const rows = blockRows(json, "history");
    if (!rows.length) break;
    for (const r of rows) {
      const price = Number(r.CLOSE ?? r.LEGALCLOSEPRICE ?? r.WAPRICE);
      if (r.TRADEDATE && Number.isFinite(price) && price > 0) out.push({ date: r.TRADEDATE, close: price });
    }
    if (rows.length < 100) break;
    start += rows.length;
  }
  return out;
}

export default async function handler(req, res) {
  const secid = String(req.query.ticker || "").trim().toUpperCase();
  const from = String(req.query.from || "").trim();
  const till = String(req.query.till || "").trim();
  if (!secid || !from || !till) return send(res, 400, { error: "Нужны ticker, from, till" });
  if (["CASH", "RUB", "MNYMKT"].includes(secid)) return send(res, 200, { ticker: secid, board: "CASH", rows: [] });

  try {
    const board = await loadBoard(secid);
    if (!board) return send(res, 404, { ticker: secid, error: "Тикер не найден на основных board MOEX" });
    const rows = await loadHistory(secid, board, from, till);
    if (!rows.length) return send(res, 404, { ticker: secid, board, error: "Нет данных за выбранный диапазон" });
    send(res, 200, { ticker: secid, board, rows });
  } catch (e) {
    send(res, 504, { ticker: secid, error: e?.name === "AbortError" ? "Таймаут источника" : String(e.message || e) });
  }
}
