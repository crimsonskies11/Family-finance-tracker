// ─────────────────────────────────────────────────────────────────────────────
// Family Finance Dashboard — self-contained single file
// Drop into any React 18+ environment. No extra dependencies required.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback, useEffect, useRef } from "react";

// ── Design tokens ─────────────────────────────────────────────────────────
const C = {
  bg: "#07090f", surface: "#0d1117", card: "#111820", border: "#1a2332",
  accent: "#00c8ff", gold: "#f0b429", green: "#10b981", red: "#f43f5e",
  purple: "#a78bfa", orange: "#fb923c", muted: "#4a5568", dim: "#7a8fa8",
  text: "#dde5f0", textBright: "#f0f4fa",
};

// ── Defaults ───────────────────────────────────────────────────────────────
const DEFAULT_STOCKS = [
  { id: 1, ticker: "PLTR",  name: "Palantir Technologies",           shares: 500,  price: 143.06, change: -3.05, type: "stock",      color: C.accent,  isPrimary: true, source: "manual" },
  { id: 2, ticker: "QQQI",  name: "NEOS Nasdaq-100 High Income ETF", shares: 2000, price: 49.42,  change: -1.48, type: "etf",        color: C.gold,    isPrimary: true, source: "manual", yieldPct: 14.79 },
  { id: 3, ticker: "AAPL",  name: "Apple Inc.",                      shares: 50,   price: 247.25, change: -0.85, type: "stock",      color: C.purple,  isPrimary: true, source: "manual" },
  { id: 4, ticker: "VINIX", name: "Vanguard Institutional Index I",  shares: 10,   price: 553.25, change:  0.21, type: "mutualfund", color: "#34d399", isPrimary: true, source: "manual" },
];
const DEFAULT_OTHER    = { homeEquity: 280000, cash: 45000, retirement401k: 95000, pensionValue: 60000, hra: 8000 };
const DEFAULT_GOAL     = 1000000;
const DEFAULT_GOAL_AGE = 45;
const CURRENT_AGE      = 38;
const COLORS_POOL      = [C.green, C.purple, C.orange, "#f472b6", "#34d399", "#60a5fa", "#fbbf24", "#e879f9"];
const LS_KEYS          = { stocks: "ffd_stocks", other: "ffd_other", goal: "ffd_goal", goalAge: "ffd_goalAge" };
const AUTO_INTERVALS   = [
  { label: "Auto: Off", value: 0 },
  { label: "1 min",     value: 60000 },
  { label: "5 min",     value: 300000 },
  { label: "15 min",    value: 900000 },
];
let idCounter = 20;

// ── localStorage helpers ───────────────────────────────────────────────────
const lsGet = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// ── Formatters ─────────────────────────────────────────────────────────────
const fc  = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
const fcd = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fp  = (v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`;

// ── API layer ──────────────────────────────────────────────────────────────
async function fetchYahooBatch(tickers) {
  if (!tickers.length) return {};
  const symbols = tickers.map(encodeURIComponent).join(",");
  const res = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const json = await res.json();
  const results = json.quoteResponse?.result;
  if (!results?.length) throw new Error("No results from Yahoo Finance");
  const typeMap = { EQUITY: "stock", ETF: "etf", MUTUALFUND: "mutualfund", CRYPTOCURRENCY: "crypto" };
  return Object.fromEntries(
    results.map((q) => [
      q.symbol,
      {
        price: q.regularMarketPrice,
        change: q.regularMarketChangePercent ?? 0,
        name: q.longName || q.shortName || q.symbol,
        type: typeMap[(q.quoteType || "").toUpperCase()] ?? "stock",
        marketState: q.marketState ?? "CLOSED",
        updatedAt: q.regularMarketTime ? q.regularMarketTime * 1000 : Date.now(),
        source: "yahoo",
      },
    ])
  );
}

async function fetchClaudeFallback(ticker) {
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
      system: `Return ONLY a valid JSON object (no markdown) with: name (string), price (number), change (number, 0 if unknown), type ("stock"|"etf"|"mutualfund"|"crypto")`,
      messages: [{ role: "user", content: `Ticker: ${ticker}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API HTTP ${res.status}`);
  const data = await res.json();
  const raw = (data.content?.[0]?.text || "")
    .trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return { ...JSON.parse(raw), source: "claude", updatedAt: Date.now() };
}

async function fetchTickerInfo(ticker) {
  try {
    const map = await fetchYahooBatch([ticker]);
    const d = map[ticker];
    if (!d) throw new Error("not found");
    return d;
  } catch {
    return fetchClaudeFallback(ticker);
  }
}

function getMarketStatus() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const min = parseInt(p.hour) * 60 + parseInt(p.minute);
  if (p.weekday === "Sat" || p.weekday === "Sun") return "closed";
  if (min >= 570 && min < 960)  return "open";
  if (min >= 240 && min < 570)  return "pre";
  if (min >= 960 && min < 1200) return "after";
  return "closed";
}

function formatAge(ts) {
  if (!ts) return null;
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── UI Primitives ──────────────────────────────────────────────────────────
const Tag = ({ children, color = C.accent }) => (
  <span style={{ background: `${color}18`, border: `1px solid ${color}44`, color, borderRadius: 4, padding: "1px 6px", fontSize: "0.6rem", fontFamily: "monospace", letterSpacing: "0.05em", fontWeight: 700 }}>
    {children}
  </span>
);
const SourceBadge = ({ source }) => {
  if (source === "yahoo")  return <Tag color={C.green}>LIVE</Tag>;
  if (source === "claude") return <Tag color={C.gold}>EST</Tag>;
  return <Tag color={C.muted}>—</Tag>;
};
const Pill = ({ children, active, onClick }) => (
  <button onClick={onClick} style={{ padding: "0.35rem 0.9rem", borderRadius: 6, border: "none", cursor: "pointer", fontSize: "0.72rem", fontWeight: 500, transition: "all 0.15s", background: active ? C.accent : "transparent", color: active ? "#07090f" : C.dim }}>
    {children}
  </button>
);
const Bar = ({ pct, color = C.accent, height = 5 }) => (
  <div style={{ height, background: "#1a2332", borderRadius: height, overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color, borderRadius: height, boxShadow: `0 0 8px ${color}55`, transition: "width 0.8s cubic-bezier(.4,0,.2,1)" }} />
  </div>
);
const Card = ({ children, style = {}, glow }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", ...(glow ? { boxShadow: `0 0 32px ${C.accent}12, 0 0 0 1px ${C.accent}22` } : {}), ...style }}>
    {children}
  </div>
);
const Lbl = ({ children }) => (
  <div style={{ color: C.muted, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "0.35rem", fontWeight: 600 }}>
    {children}
  </div>
);
const BigNum = ({ val, color = C.accent, size = "1.9rem" }) => (
  <div style={{ fontFamily: "'DM Mono','Fira Code',monospace", fontSize: size, fontWeight: 700, color, textShadow: `0 0 24px ${color}44`, lineHeight: 1.1 }}>
    {val}
  </div>
);
const Inp = ({ value, onChange, placeholder, style = {} }) => (
  <input value={value} onChange={onChange} placeholder={placeholder} style={{ background: "#0a0e16", border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: "0.42rem 0.65rem", fontSize: "0.76rem", fontFamily: "'DM Mono',monospace", outline: "none", width: "100%", boxSizing: "border-box", ...style }} />
);

// ── Market Status Badge ───────────────────────────────────────────────────
function MarketStatusBadge() {
  const [status, setStatus] = useState(getMarketStatus);
  useEffect(() => {
    const id = setInterval(() => setStatus(getMarketStatus()), 60000);
    return () => clearInterval(id);
  }, []);
  const cfg = { open: { color: C.green, label: "Market Open" }, pre: { color: C.gold, label: "Pre-Market" }, after: { color: C.orange, label: "After-Hours" }, closed: { color: C.muted, label: "Market Closed" } }[status];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color, boxShadow: status === "open" ? `0 0 7px ${cfg.color}` : "none" }} />
      <span style={{ fontSize: "0.6rem", color: cfg.color, fontFamily: "monospace", fontWeight: 600 }}>{cfg.label}</span>
    </div>
  );
}

// ── Live ET Clock ─────────────────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ fontSize: "0.6rem", color: C.dim, fontFamily: "monospace" }}>{time} ET</span>;
}

// ── Refresh Button ─────────────────────────────────────────────────────────
function RefreshButton({ stocks, onRefreshComplete, autoInterval, onAutoIntervalChange }) {
  const [state, setState] = useState("idle");
  const [lastTs, setLastTs] = useState(() => { const s = lsGet("ffd_lastRefreshed", null); return s ? Number(s) : null; });
  const [errors, setErrors] = useState([]);
  const [age, setAge] = useState(null);
  const autoRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setAge(lastTs ? formatAge(lastTs) : null), 15000);
    setAge(lastTs ? formatAge(lastTs) : null);
    return () => clearInterval(id);
  }, [lastTs]);

  const doRefresh = useCallback(async () => {
    if (state === "loading") return;
    setState("loading"); setErrors([]);
    const tickerStocks = stocks.filter((s) => !s.isManual);
    const updates = [], errs = [];
    try {
      const priceMap = await fetchYahooBatch(tickerStocks.map((s) => s.ticker));
      for (const s of tickerStocks) {
        const d = priceMap[s.ticker];
        if (d) updates.push({ id: s.id, price: d.price, change: d.change, source: "yahoo", marketState: d.marketState, updatedAt: d.updatedAt });
        else errs.push(s.ticker);
      }
      if (errs.length) {
        const fb = await Promise.allSettled(errs.map(async (ticker) => {
          const s = tickerStocks.find((x) => x.ticker === ticker);
          const d = await fetchTickerInfo(ticker);
          return { id: s.id, price: d.price, change: d.change, source: d.source ?? "claude", updatedAt: Date.now() };
        }));
        fb.forEach((r, i) => { if (r.status === "fulfilled") { updates.push(r.value); errs.splice(i, 1); } });
      }
    } catch {
      const fb = await Promise.allSettled(tickerStocks.map(async (s) => {
        const d = await fetchTickerInfo(s.ticker);
        return { id: s.id, price: d.price, change: d.change, source: "claude", updatedAt: Date.now() };
      }));
      fb.forEach((r, i) => { if (r.status === "fulfilled") updates.push(r.value); else errs.push(tickerStocks[i].ticker); });
    }
    onRefreshComplete(updates);
    const now = Date.now();
    setLastTs(now); lsSet("ffd_lastRefreshed", now); setAge(formatAge(now));
    setState(errs.length ? "error" : "done"); setErrors(errs);
    setTimeout(() => setState("idle"), 4000);
  }, [stocks, state, onRefreshComplete]);

  useEffect(() => {
    if (autoRef.current) clearInterval(autoRef.current);
    if (autoInterval > 0) autoRef.current = setInterval(doRefresh, autoInterval);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [autoInterval, doRefresh]);

  const btnColor = state === "done" ? C.green : state === "error" ? C.red : C.dim;
  const btnBg    = state === "done" ? `${C.green}18` : state === "error" ? `${C.red}18` : C.surface;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      {age && state !== "loading" && (
        <span style={{ fontSize: "0.6rem", color: state === "error" ? C.red : C.muted, fontFamily: "monospace" }}>
          {state === "error" ? `⚠ ${errors.join(", ")} failed` : `↻ ${age}`}
        </span>
      )}
      <select value={autoInterval} onChange={(e) => onAutoIntervalChange(Number(e.target.value))}
        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 6, padding: "0.35rem 0.5rem", fontSize: "0.68rem", cursor: "pointer", outline: "none" }}>
        {AUTO_INTERVALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button onClick={doRefresh} disabled={state === "loading"}
        style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.38rem 0.85rem", borderRadius: 7, border: `1px solid ${C.border}`, cursor: state === "loading" ? "not-allowed" : "pointer", fontSize: "0.72rem", fontWeight: 600, transition: "all 0.2s", background: btnBg, color: btnColor, borderColor: state === "done" ? `${C.green}44` : state === "error" ? `${C.red}44` : C.border, opacity: state === "loading" ? 0.7 : 1 }}>
        {state === "loading" ? (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" style={{ animation: "spin 0.8s linear infinite" }}>
              <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
              <circle cx="6" cy="6" r="4.5" fill="none" stroke={C.accent} strokeWidth="1.5" strokeDasharray="14 6" />
            </svg>
            <span style={{ color: C.accent }}>Fetching…</span>
          </>
        ) : state === "done" ? <><span>✓</span><span>Updated</span></>
          : state === "error" ? <><span>⚠</span><span>Retry</span></>
          : <><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 6A4 4 0 1 1 6 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M6 0.5L7.5 2L6 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Refresh Prices</span></>}
      </button>
    </div>
  );
}

// ── Add Modal ──────────────────────────────────────────────────────────────
function AddModal({ onAdd, onClose }) {
  const [mode, setMode]         = useState("ticker");
  const [ticker, setTicker]     = useState("");
  const [shares, setShares]     = useState("");
  const [manualName, setManualName]   = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualType, setManualType]   = useState("stock");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [fetched, setFetched]   = useState(null);
  const pickColor = () => COLORS_POOL[Math.floor(Math.random() * COLORS_POOL.length)];

  const handleFetch = async () => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setError(""); setFetched(null);
    try { setFetched(await fetchTickerInfo(sym)); }
    catch { setError(`Could not find "${sym}". Try manual entry.`); }
    setLoading(false);
  };

  const confirmTicker = () => {
    if (!fetched || !shares) return;
    onAdd({ id: ++idCounter, ticker: ticker.trim().toUpperCase(), name: fetched.name, shares: parseFloat(shares), price: fetched.price, change: fetched.change ?? 0, type: fetched.type, color: pickColor(), isPrimary: false, source: fetched.source ?? "yahoo" });
    onClose();
  };
  const confirmManual = () => {
    if (!manualName || !manualValue) return;
    onAdd({ id: ++idCounter, ticker: manualName.replace(/\s+/g, "").slice(0, 6).toUpperCase(), name: manualName, shares: 1, price: parseFloat(manualValue), change: 0, type: manualType, color: pickColor(), isPrimary: false, isManual: true, source: "manual" });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#07090fee", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "1.75rem", width: 400, maxWidth: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", color: C.textBright }}>Add Investment</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: "1.3rem", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: "1.25rem", background: C.surface, padding: "0.25rem", borderRadius: 7 }}>
          <Pill active={mode === "ticker"} onClick={() => { setMode("ticker"); setError(""); setFetched(null); }}>Ticker Lookup</Pill>
          <Pill active={mode === "manual"} onClick={() => { setMode("manual"); setError(""); setFetched(null); }}>Manual Entry</Pill>
        </div>
        {mode === "ticker" && (
          <div>
            <Lbl>Symbol</Lbl>
            <div style={{ display: "flex", gap: 6, marginBottom: "0.75rem" }}>
              <Inp value={ticker} onChange={(e) => { setTicker(e.target.value.toUpperCase()); setError(""); setFetched(null); }} placeholder="e.g. NVDA, BTC, VINIX" style={{ flex: 1 }} />
              <button onClick={handleFetch} disabled={loading || !ticker.trim()} style={{ background: loading ? C.muted : C.accent, border: "none", color: "#07090f", borderRadius: 6, padding: "0 0.9rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.75rem" }}>
                {loading ? "…" : "Look Up"}
              </button>
            </div>
            {error && (
              <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}33`, borderRadius: 7, padding: "0.65rem 0.75rem", marginBottom: "0.75rem" }}>
                <div style={{ color: C.red, fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.3rem" }}>Lookup failed</div>
                <div style={{ color: C.dim, fontSize: "0.68rem" }}>{error}</div>
                <button onClick={() => setMode("manual")} style={{ marginTop: "0.5rem", background: "transparent", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 5, padding: "0.3rem 0.65rem", cursor: "pointer", fontSize: "0.68rem" }}>Switch to Manual →</button>
              </div>
            )}
            {fetched && (
              <>
                <div style={{ background: "#0a0e16", borderRadius: 8, padding: "0.85rem", marginBottom: "0.85rem", border: `1px solid ${C.accent}33` }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ color: C.accent, fontFamily: "monospace", fontWeight: 700 }}>{ticker}</div>
                      <div style={{ color: C.dim, fontSize: "0.7rem", marginTop: 2 }}>{fetched.name}</div>
                      <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                        <Tag color={fetched.type === "crypto" ? C.gold : fetched.type === "mutualfund" ? C.green : C.accent}>{fetched.type === "mutualfund" ? "FUND" : fetched.type?.toUpperCase()}</Tag>
                        <SourceBadge source={fetched.source} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "monospace", color: C.textBright, fontSize: "1rem" }}>{fcd(fetched.price)}</div>
                      <div style={{ color: (fetched.change ?? 0) >= 0 ? C.green : C.red, fontSize: "0.68rem" }}>{fp(fetched.change ?? 0)}</div>
                    </div>
                  </div>
                </div>
                <Lbl>Shares / Units</Lbl>
                <Inp value={shares} onChange={(e) => setShares(e.target.value)} placeholder="e.g. 100" style={{ marginBottom: "0.5rem" }} />
                {shares && <div style={{ color: C.dim, fontSize: "0.7rem", marginBottom: "1rem" }}>Position value: {fc(parseFloat(shares || 0) * (fetched.price || 0))}</div>}
                <button onClick={confirmTicker} disabled={!shares} style={{ width: "100%", background: C.accent, border: "none", color: "#07090f", borderRadius: 7, padding: "0.6rem", fontWeight: 700, fontSize: "0.8rem", cursor: shares ? "pointer" : "not-allowed", opacity: shares ? 1 : 0.5 }}>Add to Dashboard</button>
              </>
            )}
          </div>
        )}
        {mode === "manual" && (
          <div>
            <div style={{ display: "flex", gap: 4, marginBottom: "1rem" }}>
              {["stock", "etf", "crypto", "mutualfund"].map((t) => <Pill key={t} active={manualType === t} onClick={() => setManualType(t)}>{t === "mutualfund" ? "FUND" : t.toUpperCase()}</Pill>)}
            </div>
            <Lbl>Name / Label</Lbl>
            <Inp value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="e.g. Bitcoin, Vanguard Bond" style={{ marginBottom: "0.85rem" }} />
            <Lbl>Total Value ($)</Lbl>
            <Inp value={manualValue} onChange={(e) => setManualValue(e.target.value)} placeholder="e.g. 15000" style={{ marginBottom: "1.25rem" }} />
            <button onClick={confirmManual} disabled={!manualName || !manualValue} style={{ width: "100%", background: C.gold, border: "none", color: "#07090f", borderRadius: 7, padding: "0.6rem", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", opacity: manualName && manualValue ? 1 : 0.5 }}>Add to Dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stocks,       setStocks]       = useState(() => lsGet(LS_KEYS.stocks,  DEFAULT_STOCKS));
  const [other,        setOther]        = useState(() => lsGet(LS_KEYS.other,   DEFAULT_OTHER));
  const [goal,         setGoal]         = useState(() => lsGet(LS_KEYS.goal,    DEFAULT_GOAL));
  const [goalAge,      setGoalAge]      = useState(() => lsGet(LS_KEYS.goalAge, DEFAULT_GOAL_AGE));
  const [tab,          setTab]          = useState("overview");
  const [showModal,    setShowModal]    = useState(false);
  const [savedFlash,   setSavedFlash]   = useState(false);
  const [autoInterval, setAutoInterval] = useState(0);

  useEffect(() => { lsSet(LS_KEYS.stocks,  stocks);  }, [stocks]);
  useEffect(() => { lsSet(LS_KEYS.other,   other);   }, [other]);
  useEffect(() => { lsSet(LS_KEYS.goal,    goal);    }, [goal]);
  useEffect(() => { lsSet(LS_KEYS.goalAge, goalAge); }, [goalAge]);

  useEffect(() => {
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(t);
  }, [stocks, other, goal, goalAge]);

  const addInv          = useCallback((inv) => setStocks((s) => [...s, inv]), []);
  const removeInv       = useCallback((id)  => setStocks((s) => s.filter((x) => x.id !== id)), []);
  const updateShares    = useCallback((id, v) => setStocks((s) => s.map((x) => x.id === id ? { ...x, shares: parseFloat(v) || 0 } : x)), []);
  const updateManualVal = useCallback((id, v) => setStocks((s) => s.map((x) => x.id === id ? { ...x, price:  parseFloat(v) || 0 } : x)), []);

  const handleRefreshComplete = useCallback((updates) => {
    setStocks((s) => s.map((stock) => {
      const u = updates.find((u) => u.id === stock.id);
      return u ? { ...stock, price: u.price, change: u.change, source: u.source, marketState: u.marketState, updatedAt: u.updatedAt } : stock;
    }));
  }, []);

  const resetToDefaults = () => {
    if (!window.confirm("Reset all data to defaults?")) return;
    Object.values(LS_KEYS).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem("ffd_lastRefreshed");
    setStocks(DEFAULT_STOCKS); setOther(DEFAULT_OTHER);
    setGoal(DEFAULT_GOAL); setGoalAge(DEFAULT_GOAL_AGE);
  };

  const investTotal  = stocks.reduce((s, x) => s + x.shares * x.price, 0);
  const retireTotal  = other.retirement401k + other.pensionValue + other.hra;
  const netWorth     = investTotal + other.homeEquity + other.cash + retireTotal;
  const gap          = Math.max(goal - netWorth, 0);
  const progress     = (netWorth / goal) * 100;
  const yearsLeft    = goalAge - CURRENT_AGE;
  const pltr         = stocks.find((s) => s.ticker === "PLTR");
  const qqqi         = stocks.find((s) => s.ticker === "QQQI");
  const pltrPct      = pltr ? (pltr.price / 418) * 100 : 0;
  const pltrAtTrigger = pltr ? pltr.shares * 418 : 0;
  const qqqiYield    = qqqi?.yieldPct ?? 14.79;
  const qqqiMonthly  = qqqi ? (qqqi.shares * qqqi.price * (qqqiYield / 100)) / 12 : 0;
  const allocData    = [
    ...stocks.map((s) => ({ label: s.ticker, value: s.shares * s.price, color: s.color })),
    { label: "Home Equity", value: other.homeEquity, color: C.green },
    { label: "Cash",        value: other.cash,        color: C.muted },
    { label: "Retirement",  value: retireTotal,        color: C.orange },
  ].filter((a) => a.value > 0);
  const allocTotal = allocData.reduce((s, a) => s + a.value, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: "1.25rem", fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      {showModal && <AddModal onAdd={addInv} onClose={() => setShowModal(false)} />}

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <MarketStatusBadge />
            <LiveClock />
            <span style={{ fontSize: "0.58rem", color: C.green, fontFamily: "monospace", opacity: savedFlash ? 1 : 0, transition: "opacity 0.4s ease" }}>✓ saved</span>
          </div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600, color: C.textBright, letterSpacing: "-0.025em" }}>Family Finance Dashboard</h1>
          <p style={{ margin: "3px 0 0", color: C.muted, fontSize: "0.73rem" }}>Joey & Family · Millionaire by {goalAge} · {yearsLeft}y to go</p>
        </div>
        <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", alignItems: "center" }}>
          {stocks.slice(0, 4).map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 5, alignItems: "center", padding: "0.28rem 0.6rem", background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
              <span style={{ color: s.color, fontFamily: "monospace", fontSize: "0.62rem", fontWeight: 700 }}>{s.ticker}</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.68rem" }}>{fcd(s.price)}</span>
              <span style={{ color: s.change >= 0 ? C.green : C.red, fontSize: "0.6rem" }}>{fp(s.change)}</span>
              <SourceBadge source={s.source} />
            </div>
          ))}
          <RefreshButton stocks={stocks} onRefreshComplete={handleRefreshComplete} autoInterval={autoInterval} onAutoIntervalChange={setAutoInterval} />
          <button onClick={() => setShowModal(true)} style={{ background: C.accent, border: "none", color: "#07090f", borderRadius: 7, padding: "0.4rem 0.85rem", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>+ Add</button>
        </div>
      </div>

      {/* HERO */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.85rem", marginBottom: "1.15rem" }}>
        <Card glow>
          <Lbl>Total Net Worth</Lbl>
          <BigNum val={fc(netWorth)} />
          <div style={{ marginTop: "0.7rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: "0.6rem", color: C.muted }}>Progress to {fc(goal)}</span>
              <span style={{ fontSize: "0.6rem", color: C.accent, fontFamily: "monospace" }}>{progress.toFixed(1)}%</span>
            </div>
            <Bar pct={progress} color={progress >= 100 ? C.green : C.accent} />
          </div>
        </Card>
        <Card>
          <Lbl>Gap to Goal</Lbl>
          <BigNum val={fc(gap)} color={C.gold} />
          <div style={{ marginTop: 6, fontSize: "0.68rem", color: C.muted }}>Need <span style={{ color: C.gold }}>{fc(gap / yearsLeft)}/yr</span> avg growth</div>
        </Card>
        <Card>
          <Lbl>PLTR @ $1T Trigger ($418)</Lbl>
          <BigNum val={fc(pltrAtTrigger)} color={C.green} />
          <div style={{ marginTop: "0.7rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: "0.6rem", color: C.muted }}>${pltr?.price?.toFixed(2) ?? "—"} → $418</span>
              <span style={{ fontSize: "0.6rem", color: C.green, fontFamily: "monospace" }}>{pltrPct.toFixed(1)}%</span>
            </div>
            <Bar pct={pltrPct} color={C.green} />
          </div>
        </Card>
        <Card>
          <Lbl>QQQI Monthly Income</Lbl>
          <BigNum val={fc(qqqiMonthly)} color={C.gold} />
          <div style={{ marginTop: 6, fontSize: "0.68rem", color: C.muted }}>
            {qqqi ? `${qqqiYield}% yield · ${qqqi.shares.toLocaleString()} shares` : "No QQQI position"}
          </div>
        </Card>
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: 3, marginBottom: "1.1rem", background: C.card, padding: "0.25rem", borderRadius: 8, border: `1px solid ${C.border}`, width: "fit-content" }}>
        {["overview", "investments", "milestones", "adjust"].map((t) => <Pill key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Pill>)}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: "0.85rem" }}>
          <Card>
            <Lbl>Allocation Breakdown</Lbl>
            {allocData.map((a) => (
              <div key={a.label} style={{ marginBottom: "0.55rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "0.73rem", color: a.color, fontWeight: 500 }}>{a.label}</span>
                  <span style={{ fontSize: "0.68rem", color: C.dim, fontFamily: "monospace" }}>{fc(a.value)} · {((a.value / allocTotal) * 100).toFixed(1)}%</span>
                </div>
                <Bar pct={(a.value / allocTotal) * 100} color={a.color} height={4} />
              </div>
            ))}
          </Card>
          <Card>
            <Lbl>Asset Buckets</Lbl>
            {[
              { label: "Brokerage / Investments", value: investTotal,      color: C.accent },
              { label: "Home Equity (LA County)",  value: other.homeEquity, color: C.green },
              { label: "Retirement Accounts",      value: retireTotal,      color: C.orange },
              { label: "Cash Savings",             value: other.cash,       color: C.muted },
            ].map((b) => (
              <div key={b.label} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                  <span style={{ fontSize: "0.73rem" }}>{b.label}</span>
                </div>
                <span style={{ fontFamily: "monospace", fontSize: "0.73rem", color: b.color }}>{fc(b.value)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "0.6rem" }}>
              <span style={{ fontSize: "0.76rem", fontWeight: 600, color: C.textBright }}>Total Net Worth</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.76rem", color: C.accent, fontWeight: 700 }}>{fc(netWorth)}</span>
            </div>
          </Card>
          <Card>
            <Lbl>All Positions ({stocks.length})</Lbl>
            {stocks.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Tag color={s.color}>{s.ticker}</Tag>
                  <span style={{ fontSize: "0.68rem", color: C.dim }}>{s.isManual ? "Manual" : `${s.shares.toLocaleString()} sh`}</span>
                  <SourceBadge source={s.source} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.73rem" }}>{fc(s.shares * s.price)}</div>
                  <div style={{ fontSize: "0.6rem", color: s.change >= 0 ? C.green : C.red }}>{fp(s.change)}</div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "0.6rem" }}>
              <span style={{ fontSize: "0.73rem", color: C.muted }}>Total Invested</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.73rem", color: C.accent, fontWeight: 700 }}>{fc(investTotal)}</span>
            </div>
          </Card>
        </div>
      )}

      {/* INVESTMENTS */}
      {tab === "investments" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(255px, 1fr))", gap: "0.85rem" }}>
          {stocks.map((s) => (
            <Card key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.85rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ color: s.color, fontFamily: "monospace", fontWeight: 700, fontSize: "0.95rem" }}>{s.ticker}</span>
                    <Tag color={s.type === "crypto" ? C.gold : s.type === "etf" ? C.purple : s.type === "mutualfund" ? C.green : C.accent}>{s.type === "mutualfund" ? "FUND" : s.type?.toUpperCase()}</Tag>
                    <SourceBadge source={s.source} />
                  </div>
                  <div style={{ color: C.dim, fontSize: "0.67rem" }}>{s.name}</div>
                </div>
                {!s.isPrimary && <button onClick={() => removeInv(s.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: "0.85rem", opacity: 0.65, padding: 0 }}>✕</button>}
              </div>
              <div style={{ background: "#0a0e16", borderRadius: 8, padding: "0.7rem", marginBottom: "0.7rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: "0.6rem", color: C.muted }}>{s.isManual ? "Manual Value" : "Price"}</span>
                  {!s.isManual && <span style={{ color: s.change >= 0 ? C.green : C.red, fontSize: "0.6rem" }}>{fp(s.change)}</span>}
                </div>
                <BigNum val={s.isManual ? fc(s.price) : fcd(s.price)} color={s.color} size="1.25rem" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.7rem" }}>
                <div>
                  <Lbl>{s.isManual ? "Value ($)" : "Shares"}</Lbl>
                  <input type="number" value={s.isManual ? s.price : s.shares} onChange={(e) => s.isManual ? updateManualVal(s.id, e.target.value) : updateShares(s.id, e.target.value)}
                    style={{ background: "#0a0e16", border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: "0.32rem 0.5rem", fontSize: "0.73rem", fontFamily: "monospace", width: "100%", boxSizing: "border-box", outline: "none" }} />
                </div>
                <div>
                  <Lbl>Position Value</Lbl>
                  <div style={{ fontFamily: "monospace", fontSize: "0.76rem", color: s.color, paddingTop: 7 }}>{fc(s.shares * s.price)}</div>
                </div>
              </div>
              {s.yieldPct && (
                <div style={{ background: `${C.gold}10`, border: `1px solid ${C.gold}22`, borderRadius: 6, padding: "0.45rem 0.6rem", marginBottom: "0.6rem" }}>
                  <div style={{ fontSize: "0.62rem", color: C.gold, marginBottom: 2 }}>Monthly Income (DRIP)</div>
                  <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: C.gold }}>{fc((s.shares * s.price * (s.yieldPct / 100)) / 12)}/mo</span>
                </div>
              )}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "0.6rem", color: C.muted }}>% of investments</span>
                  <span style={{ fontSize: "0.6rem", color: C.dim, fontFamily: "monospace" }}>{investTotal > 0 ? ((s.shares * s.price / investTotal) * 100).toFixed(1) : 0}%</span>
                </div>
                <Bar pct={investTotal > 0 ? (s.shares * s.price / investTotal) * 100 : 0} color={s.color} height={3} />
              </div>
            </Card>
          ))}
          <div onClick={() => setShowModal(true)}
            style={{ border: `2px dashed ${C.border}`, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", minHeight: 180, gap: 8, transition: "border-color 0.15s" }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = C.accent}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = C.border}>
            <div style={{ fontSize: "1.8rem", color: C.muted }}>+</div>
            <div style={{ color: C.muted, fontSize: "0.73rem", textAlign: "center" }}>Add Stock, ETF,<br />Mutual Fund, or Crypto</div>
          </div>
        </div>
      )}

      {/* MILESTONES */}
      {tab === "milestones" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: "0.85rem" }}>
          <Card>
            <Lbl>🚀 Phase 1 — PLTR to $1 Trillion</Lbl>
            <h3 style={{ margin: "0 0 0.2rem", fontSize: "0.88rem", color: C.accent }}>Hold until ~$418/share</h3>
            <p style={{ margin: "0 0 1rem", color: C.muted, fontSize: "0.7rem" }}>Exit trigger ≈ $1T market cap</p>
            {[
              { label: "Price progress",      pct: pltrPct, color: C.accent, right: `$${pltr?.price?.toFixed(2) ?? "—"} / $418` },
              { label: "Market cap progress", pct: 34.2,    color: C.green,  right: "$342B / $1T" },
            ].map((r) => (
              <div key={r.label} style={{ marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: "0.62rem", color: C.muted }}>{r.label}</span>
                  <span style={{ fontSize: "0.62rem", color: r.color, fontFamily: "monospace" }}>{r.right}</span>
                </div>
                <Bar pct={r.pct} color={r.color} />
              </div>
            ))}
            <div style={{ background: "#0a0e16", borderRadius: 8, padding: "0.75rem" }}>
              <Lbl>Exit Value ({pltr?.shares?.toLocaleString() ?? 0} shares @ $418)</Lbl>
              <BigNum val={fc(pltrAtTrigger)} color={C.green} size="1.35rem" />
              <div style={{ fontSize: "0.67rem", color: C.muted, marginTop: 4 }}>Gain vs today: +{fc(pltr ? (418 - pltr.price) * pltr.shares : 0)}</div>
            </div>
          </Card>
          <Card>
            <Lbl>💰 Phase 2 — QQQI Income Targets</Lbl>
            <h3 style={{ margin: "0 0 0.2rem", fontSize: "0.88rem", color: C.gold }}>Post-PLTR rotation</h3>
            <p style={{ margin: "0 0 1rem", color: C.muted, fontSize: "0.7rem" }}>At {qqqiYield}% yield · QQQI @ {fcd(qqqi?.price ?? 49.42)}</p>
            {[5800, 6600, 10000, 15000].map((mo) => {
              const price = qqqi?.price ?? 49.42;
              const needed = Math.ceil((mo * 12) / (price * (qqqiYield / 100)));
              const current = qqqi?.shares ?? 0;
              return (
                <div key={mo} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.gold, fontSize: "0.76rem", fontWeight: 600 }}>{fc(mo)}/mo</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "0.67rem", color: C.dim, fontFamily: "monospace" }}>{needed.toLocaleString()} sh · {fc(needed * price)}</div>
                    <div style={{ fontSize: "0.6rem", color: current >= needed ? C.green : C.muted }}>{current >= needed ? "✓ Reached" : `Need ${(needed - current).toLocaleString()} more`}</div>
                  </div>
                </div>
              );
            })}
          </Card>
          <Card>
            <Lbl>🏆 Net Worth Milestones</Lbl>
            {[250000, 500000, 750000, 1000000, 1500000, 2000000].map((m) => {
              const done = netWorth >= m, close = !done && netWorth >= m * 0.8;
              return (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.5rem 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, border: `2px solid ${done ? C.green : close ? C.gold : C.border}`, background: done ? C.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {done && <span style={{ fontSize: "0.52rem", color: "#000", fontWeight: 700 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.73rem", color: done ? C.textBright : C.muted }}>{fc(m)}{m === 1000000 ? " 🎉" : ""}</div>
                    {!done && <div style={{ fontSize: "0.6rem", color: C.muted }}>Gap: {fc(m - netWorth)}</div>}
                  </div>
                  {close && <Tag color={C.gold}>CLOSE</Tag>}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* ADJUST */}
      {tab === "adjust" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: "0.85rem" }}>
          <Card>
            <Lbl>📈 Investment Positions</Lbl>
            {stocks.map((s) => (
              <div key={s.id} style={{ marginBottom: "0.85rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: s.color, fontFamily: "monospace", fontSize: "0.73rem", fontWeight: 700 }}>{s.ticker} <span style={{ color: C.dim, fontWeight: 400, fontSize: "0.65rem" }}>{s.name}</span></span>
                  <span style={{ fontSize: "0.68rem", color: C.dim }}>{fc(s.shares * s.price)}</span>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => s.isManual ? updateManualVal(s.id, Math.max(0, s.price - 100)) : updateShares(s.id, Math.max(0, s.shares - 1))} style={{ background: C.border, border: "none", color: C.text, borderRadius: 4, width: 26, height: 26, cursor: "pointer", flexShrink: 0 }}>−</button>
                  <input type="number" value={s.isManual ? s.price : s.shares} onChange={(e) => s.isManual ? updateManualVal(s.id, e.target.value) : updateShares(s.id, e.target.value)}
                    style={{ flex: 1, background: "#0a0e16", border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: "0.3rem 0.5rem", fontSize: "0.73rem", fontFamily: "monospace", outline: "none" }} />
                  <button onClick={() => s.isManual ? updateManualVal(s.id, s.price + 100) : updateShares(s.id, s.shares + 1)} style={{ background: C.accent, border: "none", color: "#07090f", borderRadius: 4, width: 26, height: 26, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>+</button>
                </div>
              </div>
            ))}
            <button onClick={() => setShowModal(true)} style={{ width: "100%", background: "transparent", border: `1px dashed ${C.border}`, color: C.muted, borderRadius: 7, padding: "0.5rem", cursor: "pointer", fontSize: "0.73rem", marginTop: "0.5rem" }}>+ Add New Investment</button>
          </Card>
          <Card>
            <Lbl>🏠 Other Assets</Lbl>
            {[
              { key: "homeEquity",     label: "Home Equity ($)" },
              { key: "cash",           label: "Cash Savings ($)" },
              { key: "retirement401k", label: "401(k) — Spouse ($)" },
              { key: "pensionValue",   label: "Pension / County ($)" },
              { key: "hra",            label: "HRA ($)" },
            ].map((f) => (
              <div key={f.key} style={{ marginBottom: "0.85rem" }}>
                <Lbl>{f.label}</Lbl>
                <Inp value={other[f.key]} onChange={(e) => setOther((o) => ({ ...o, [f.key]: parseFloat(e.target.value) || 0 }))} />
              </div>
            ))}
          </Card>
          <Card>
            <Lbl>🎯 Goal Settings</Lbl>
            <div style={{ marginBottom: "0.85rem" }}>
              <Lbl>Target Net Worth ($)</Lbl>
              <Inp value={goal} onChange={(e) => setGoal(parseFloat(e.target.value) || 0)} />
            </div>
            <div style={{ marginBottom: "1.25rem" }}>
              <Lbl>Goal Age</Lbl>
              <Inp value={goalAge} onChange={(e) => setGoalAge(parseInt(e.target.value) || 45)} />
              <div style={{ fontSize: "0.62rem", color: C.muted, marginTop: 4 }}>{goalAge - CURRENT_AGE} years from now</div>
            </div>
            <div style={{ background: "#0a0e16", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
              <Lbl>Live Net Worth</Lbl>
              <BigNum val={fc(netWorth)} size="1.45rem" />
              <div style={{ marginTop: "0.7rem" }}>
                <Bar pct={progress} color={progress >= 100 ? C.green : C.accent} />
                <div style={{ fontSize: "0.62rem", color: C.muted, marginTop: 4 }}>{progress.toFixed(1)}% of {fc(goal)}</div>
              </div>
            </div>
            <button onClick={resetToDefaults} style={{ width: "100%", background: "transparent", border: `1px solid ${C.red}44`, color: C.red, borderRadius: 7, padding: "0.45rem", cursor: "pointer", fontSize: "0.7rem", opacity: 0.7 }}>
              Reset all data to defaults
            </button>
          </Card>
        </div>
      )}

      <div style={{ marginTop: "1.75rem", textAlign: "center", color: C.muted, fontSize: "0.58rem" }}>
        Prices refresh via Yahoo Finance · LIVE = real-time · EST = estimated · Not financial advice
      </div>
    </div>
  );
}
