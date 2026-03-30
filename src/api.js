// ── Yahoo Finance batch fetcher ───────────────────────────────────────────
// Fetches real-time quotes for multiple tickers in a single request.
// Returns a map: { [ticker]: { price, change, name, type, marketState, updatedAt } }
export async function fetchYahooBatch(tickers) {
  if (!tickers.length) return {};
  const symbols = tickers.map(encodeURIComponent).join(",");
  const res = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const json = await res.json();
  const results = json.quoteResponse?.result;
  if (!results?.length) throw new Error("Yahoo Finance returned no results");

  const typeMap = { EQUITY: "stock", ETF: "etf", MUTUALFUND: "mutualfund", CRYPTOCURRENCY: "crypto" };
  return Object.fromEntries(
    results.map((q) => [
      q.symbol,
      {
        price: q.regularMarketPrice,
        change: q.regularMarketChangePercent ?? 0,
        name: q.longName || q.shortName || q.symbol,
        type: typeMap[(q.quoteType || "").toUpperCase()] ?? "stock",
        marketState: q.marketState ?? "CLOSED", // PRE | REGULAR | POST | CLOSED
        updatedAt: q.regularMarketTime ? q.regularMarketTime * 1000 : Date.now(),
        source: "yahoo",
      },
    ])
  );
}

// ── Single-ticker Yahoo fetch (for Add modal) ─────────────────────────────
export async function fetchYahooSingle(ticker) {
  const map = await fetchYahooBatch([ticker]);
  const data = map[ticker];
  if (!data) throw new Error(`Ticker "${ticker}" not found on Yahoo Finance`);
  return data;
}

// ── Claude API fallback ───────────────────────────────────────────────────
// Used only when Yahoo Finance fails (e.g. private funds, CORS, unknown tickers).
export async function fetchClaudeFallback(ticker) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: `You are a financial data assistant. Return ONLY a valid JSON object (no markdown) with:
- name: full name (string)
- price: most recently known price in USD (number)
- change: today's approximate % change (number, 0 if unknown)
- type: "stock" | "etf" | "mutualfund" | "crypto"`,
      messages: [{ role: "user", content: `Ticker: ${ticker}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API HTTP ${res.status}`);
  const data = await res.json();
  const raw = (data.content?.[0]?.text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return { ...JSON.parse(raw), source: "claude", updatedAt: Date.now() };
}

// ── Smart single ticker fetch ─────────────────────────────────────────────
// Yahoo first, Claude fallback. Used in the Add modal.
export async function fetchTickerInfo(ticker) {
  try {
    return await fetchYahooSingle(ticker);
  } catch {
    return await fetchClaudeFallback(ticker);
  }
}

// ── Market status helper ──────────────────────────────────────────────────
export function getMarketStatus() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const weekday = p.weekday;
  const totalMin = parseInt(p.hour) * 60 + parseInt(p.minute);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (totalMin >= 570 && totalMin < 960) return "open";   // 9:30–16:00
  if (totalMin >= 240 && totalMin < 570) return "pre";    // 4:00–9:30
  if (totalMin >= 960 && totalMin < 1200) return "after"; // 16:00–20:00
  return "closed";
}

// ── Format last-updated time ──────────────────────────────────────────────
export function formatAge(ts) {
  if (!ts) return null;
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
