/* Trade Radar – aplikácia (UI + dáta). Logika signálov je v engine.js */
(() => {
'use strict';
const E = window.Engine;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ───────── nastavenia ───────── */
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const DEF = {
  market: 'crypto', mode: 'swing', account: 1000, cur: '€', risk: 1,
  cost: { crypto: 0.12, etf: 0.08, stock: 0.08 }, strict: 70,
  filters: { adx: false, fib: false, vwap: false, obv: false, candle: false },
  count: 20, notify: false, auto: true, tdKey: '', watch: [],
  lists: { etf: ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'GLD', 'TLT'],
           stock: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX', 'JPM', 'COST'] },
  demo: false, theme: 'ultimate', motion: true,
  ov: { ema: true, bb: false, fib: true, vwap: false, sr: true }, sub: 'rsi'
};
const saved = ls.get('tr3.settings', null) || (() => { const o = ls.get('tr2.settings', {}); return { account: o.account, cur: o.cur, risk: o.risk, tdKey: o.tdKey, watch: (o.watch || []).filter(w => w.src === 'bn') }; })();
for (const k in saved) if (saved[k] === undefined) delete saved[k];
const S = Object.assign({}, DEF, saved);
for (const k of ['cost', 'filters', 'lists', 'ov']) S[k] = Object.assign({}, DEF[k], saved[k] || {});
if (/[?&]demo=1/.test(location.search)) S.demo = true;
const save = () => ls.set('tr3.settings', S);
let seen = new Set(ls.get('tr3.seen', []));
let LOG = ls.get('tr3.log', []);

/* ───────── trhy a štýly ───────── */
const ICON = {
  crypto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 7.5h3.8a2.1 2.1 0 010 4.2H9.5zm0 4.2h4.3a2.2 2.2 0 010 4.5H9.5zm0-4.2v8.7M11 6v1.5m0 8.7V18m2.2-12v1.5m0 8.7V18"/></svg>',
  etf: '<svg viewBox="0 0 24 24"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.3l8.5 4.5 8.5-4.5"/><path d="M3.5 16.3l8.5 4.5 8.5-4.5"/></svg>',
  stock: '<svg viewBox="0 0 24 24"><path d="M6 3.5v17M12 6v14M18 3.5v13"/><rect x="4" y="7" width="4" height="8" rx="1"/><rect x="10" y="10" width="4" height="6" rx="1"/><rect x="16" y="6" width="4" height="7" rx="1"/></svg>',
  swing: '<svg viewBox="0 0 24 24"><path d="M2.5 15.5c3 0 4-9 7-9s4 11 7 11 3.5-6 5-6"/></svg>',
  intraday: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>'
};
const MARKETS = {
  crypto: { label: 'Krypto', sub: 'Binance · 24/7 · bez kľúča', src: 'bn', unit: 'USDT' },
  etf:    { label: 'ETF', sub: 'Americké ETF · Twelve Data', src: 'td' },
  stock:  { label: 'Akcie', sub: 'Americké akcie · Twelve Data', src: 'td' }
};
const MODES = {
  swing:    { label: 'Swing', desc: 'Držíš 1–5 dní. Stačí pozrieť 2–3× denne.' },
  intraday: { label: 'Intraday', desc: 'Držíš hodiny. Treba sledovať trh počas dňa.' }
};
function spec(market, mode) {
  if (MARKETS[market].src === 'bn') return mode === 'swing'
    ? { ltf: '1h', htf: '4h', ltfMs: 36e5, htfMs: 144e5, maxBars: 72, hold: '3 dni', sub: '4H trend · 1H vstup', scanL: 400, scanH: 300, histL: 3000, histH: 1000, every: 90e3 }
    : { ltf: '15m', htf: '1h', ltfMs: 9e5, htfMs: 36e5, maxBars: 64, hold: '16 hodín', sub: '1H trend · 15M vstup', scanL: 400, scanH: 300, histL: 3000, histH: 1000, every: 90e3 };
  return mode === 'swing'
    ? { ltf: '1h', agg: Infinity, ltfMs: 36e5, htfMs: 864e5, maxBars: 35, hold: '5 obchodných dní', sub: '1D trend · 1H vstup', every: 10 * 60e3 }
    : { ltf: '15m', agg: 4, ltfMs: 9e5, htfMs: 36e5, maxBars: 26, hold: '1 obchodný deň', sub: '1H trend · 15M vstup', every: 5 * 60e3 };
}
const IV_MS = { '15m': 9e5, '1h': 36e5, '4h': 144e5 };
const STATE = { BUY: 'KÚPIŤ', WATCH: 'SLEDOVAŤ', WAIT: 'ČAKAŤ', AVOID: 'NEKUPOVAŤ' };
const ORDER = { BUY: 0, WATCH: 1, WAIT: 2, AVOID: 3 };
const ctxKey = () => `${S.market}|${S.mode}`;
const cfg = (market = S.market) => ({ minScore: S.strict, filters: S.filters, costPct: S.cost[market] });
const cfgKey = (market = S.market) => JSON.stringify(cfg(market));
const isTd = (market = S.market) => MARKETS[market].src === 'td';

/* ───────── formátovanie ───────── */
const nf = (x, d) => x.toLocaleString('sk-SK', { minimumFractionDigits: d, maximumFractionDigits: d });
const price = p => !isFinite(p) ? '—' : nf(p, p >= 100 ? 2 : p >= 1 ? 3 : p >= 0.1 ? 4 : p >= 0.01 ? 5 : 7);
const pct = (x, d = 2) => (x > 0 ? '+' : '') + nf(x, d) + ' %';
const money = x => nf(x, Math.abs(x) >= 100 ? 0 : 2) + ' ' + S.cur;
const qtyFmt = q => nf(q, q >= 100 ? 2 : q >= 1 ? 4 : 6);
const R = x => (x > 0 ? '+' : '') + nf(x, 2) + 'R';
const hhmm = t => new Date(t).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
const dmy = t => new Date(t).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
const baseOf = s => s.replace(/USDT$/, '');
const unitOf = r => r.src === 'bn' ? 'USDT' : MARKETS[r.market].label === 'ETF' ? 'ETF' : 'akcia';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3400); }
function usMarket() {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const m = (+p.hour % 24) * 60 + +p.minute;
    return !['Sat', 'Sun'].includes(p.weekday) && m >= 570 && m < 960;
  } catch { return true; }
}

/* ───────── úložisko sviečok (IndexedDB) ───────── */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('tradeRadar', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  return {
    async get(k) { try { const db = await open(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } },
    async set(k, v) { try { const db = await open(); db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch {} },
    async clear() { try { const db = await open(); db.transaction('kv', 'readwrite').objectStore('kv').clear(); } catch {} }
  };
})();

/* ───────── Binance ───────── */
const BN = ['https://data-api.binance.vision', 'https://api.binance.com'];
let bnBase = 0;
async function bnGet(path) {
  let err;
  for (let k = 0; k < BN.length; k++) {
    const b = (bnBase + k) % BN.length;
    try { const r = await fetch(BN[b] + path); if (r.ok) { bnBase = b; return await r.json(); } err = new Error('HTTP ' + r.status); }
    catch (e) { err = e; }
  }
  throw err;
}
const rowToBar = r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
async function bnKlines(sym, iv, total) {
  let out = [], end = null;
  while (out.length < total) {
    const lim = Math.min(1000, total - out.length);
    const rows = await bnGet(`/api/v3/klines?symbol=${sym}&interval=${iv}&limit=${lim}` + (end ? `&endTime=${end}` : ''));
    if (!rows.length) break;
    const bars = rows.map(rowToBar); out = bars.concat(out); end = bars[0].t - 1;
    if (rows.length < lim) break;
  }
  return out;
}
/* ───────── Twelve Data (akcie, ETF) ───────── */
let tdChain = Promise.resolve();
const tdQueue = fn => { const p = tdChain.then(fn); tdChain = p.catch(() => {}).then(() => sleep(7800)); return p; };
async function tdJson(url) {
  for (let a = 0; a < 2; a++) {
    const j = await tdQueue(() => fetch(url).then(r => r.json()));
    if (j && j.code === 429 && a === 0) { toast('Twelve Data: minútový limit – chvíľu čakám…'); await sleep(61e3); continue; }
    return j;
  }
}
async function tdKlines(sym, iv, size) {
  const ivm = { '15m': '15min', '1h': '1h' }[iv];
  const j = await tdJson(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${ivm}&outputsize=${Math.min(5000, size)}&order=ASC&timezone=UTC&apikey=${encodeURIComponent(S.tdKey)}`);
  if (!j || j.status === 'error' || !Array.isArray(j.values)) throw new Error((j && j.message) || 'Chyba Twelve Data');
  return j.values.map(v => ({ t: Date.parse(v.datetime.replace(' ', 'T') + 'Z'), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0) })).filter(b => isFinite(b.t) && b.c > 0);
}
const memSeries = new Map();
const demoStock = {};
async function tdSeries(sym, iv, ttl, cacheOnly) {
  const key = `td|${S.demo ? 'demo|' : ''}${sym}|${iv}`;
  let have = memSeries.get(key);
  if (!have && !S.demo) { have = await idb.get(key); if (have) memSeries.set(key, have); }
  if (cacheOnly) return have || null;
  if (have && Date.now() - have.at < ttl) return have;
  if (S.demo) {
    const b = demoStock[sym] || (demoStock[sym] = E.synth15('S' + sym, 60000, Date.now(), true));
    const rec = { at: Date.now(), bars: (iv === '15m' ? b : E.aggSession(b, 4)).slice(-5000) };
    memSeries.set(key, rec); return rec;
  }
  let size = 5000;
  if (have && have.bars.length >= 500) { const gap = Date.now() - have.bars[have.bars.length - 1].t; if (gap < 25 * 864e5) size = Math.min(5000, Math.ceil(gap / IV_MS[iv]) + 20); }
  try {
    const nb = await tdKlines(sym, iv, size);
    let bars = nb;
    if (have && size < 5000 && nb.length) { const first = nb[0].t; bars = have.bars.filter(b => b.t < first).concat(nb).slice(-5000); }
    const rec = { at: Date.now(), bars };
    memSeries.set(key, rec); idb.set(key, rec);
    return rec;
  } catch (e) { if (have) return Object.assign({}, have, { stale: true }); throw e; }
}
/* ───────── demo krypto ───────── */
const DEMO_SYMS = 'BTC ETH BNB SOL XRP DOGE ADA TRX AVAX LINK DOT LTC BCH NEAR UNI ATOM XLM ETC FIL INJ AAVE ARB OP SUI APT HBAR TON PEPE SHIB ICP'.split(' ').map(x => x + 'USDT');
const demoBase = {};
const demoBars = s => demoBase[s] || (demoBase[s] = E.synth15(s, 16000, Date.now()));
const cache = new Map();
function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.p;
  const p = fn(); const e = { at: Date.now(), p }; cache.set(key, e);
  p.catch(() => { if (cache.get(key) === e) cache.delete(key); });
  return p;
}
const bnSeries = (sym, iv, total, ttl) => cached(`bn|${S.demo ? 'demo|' : ''}${sym}|${iv}|${total}`, ttl, () => S.demo
  ? Promise.resolve((iv === '15m' ? demoBars(sym) : E.aggregate(demoBars(sym), IV_MS[iv])).slice(-total)) : bnKlines(sym, iv, total));
async function tickers() {
  if (S.demo) return DEMO_SYMS.map((s, i) => { const b = demoBars(s), last = b[b.length - 1].c; return { symbol: s, lastPrice: last, priceChangePercent: (last / b[b.length - 97].c - 1) * 100, quoteVolume: 1e9 / (i + 1) }; });
  return cached('tick', 240e3, () => bnGet('/api/v3/ticker/24hr'));
}
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|USDE|USD1|BUSD|EUR|EURI|AEUR|GBP|TRY|BRL|PYUSD|XUSD|RLUSD|USDS|BFUSD|UST|WBTC|WBETH)$/;
let knownTk = new Map();

/* ───────── analýza ───────── */
const M = new Map();     // ctx -> Map(sym -> záznam)
const CS = new Map();    // ctx -> stav skenovania
const BT = new Map();    // kľúč -> { res, pending, err }
const mapOf = ctx => M.get(ctx) || (M.set(ctx, new Map()), M.get(ctx));
const stOf = ctx => CS.get(ctx) || (CS.set(ctx, { scanning: false, last: 0, err: null, errAt: 0, prog: [0, 0], done: false }), CS.get(ctx));

function dailyChange(bars, px) {
  const d = Math.floor(bars[bars.length - 1].t / 864e5);
  for (let i = bars.length - 1; i >= 0; i--) if (Math.floor(bars[i].t / 864e5) < d) return (px / bars[i].c - 1) * 100;
  return 0;
}
function btStore(key, res, L) { res.trades.forEach(t => { t.sigT = L.t[t.si]; }); const e = { res }; BT.set(key, e); return e; }

async function analyze(it, market, mode, cacheOnly) {
  const sp = spec(market, mode);
  let lb0, hb0, stale = false, chg = it.chg;
  if (it.src === 'bn') {
    [lb0, hb0] = await Promise.all([bnSeries(it.sym, sp.ltf, sp.scanL, 45e3), bnSeries(it.sym, sp.htf, sp.scanH, 45e3)]);
  } else {
    const ser = await tdSeries(it.sym, sp.ltf, sp.every - 5e3, cacheOnly);
    if (!ser) return null;
    lb0 = ser.bars; hb0 = E.aggSession(lb0, sp.agg); stale = !!ser.stale;
  }
  if (!lb0.length) throw new Error('Žiadne dáta');
  const now = Date.now(), px = lb0[lb0.length - 1].c;
  const lb = lb0.filter(b => b.t + sp.ltfMs <= now), hb = hb0.filter(b => b.t + sp.htfMs <= now);
  if (lb.length < 120 || hb.length < 70) throw new Error('Málo histórie na analýzu');
  const L = E.prep(lb), H = E.prep(hb), hmap = E.mapHtf(L, H, sp.ltfMs, sp.htfMs);
  const lv = E.live(L, H, hmap, cfg(market), px);
  if (!lv) throw new Error('Nedá sa vyhodnotiť');
  if (chg == null || !isFinite(chg)) chg = dailyChange(lb0, px);
  const rec = { sym: it.sym, src: it.src, market, mode, mine: it.mine, price: px, chg, L, H, hmap, lv, state: lv.state, score: lv.score,
    sig: lv.status === 'active' ? lv.sig : null, hint: lv.hint, spark: L.c.slice(-48), at: now, stale };
  if (it.src === 'td') { const k = btKey(rec); if (!BT.has(k)) btStore(k, E.runBacktest(L, H, hmap, sp, cfg(market)), L); }
  return rec;
}

async function scan(force) {
  const market = S.market, mode = S.mode, ctx = ctxKey(), st = stOf(ctx), map = mapOf(ctx);
  if (st.scanning) return;
  if (isTd(market) && !S.tdKey && !S.demo) { st.err = { nokey: true }; render('all'); return; }
  st.scanning = true; st.err = null; render('status');
  try {
    if (force) for (const k of [...cache.keys()]) if (k === 'tick' || /\|(400|300)$/.test(k)) cache.delete(k);
    if (force && isTd(market)) for (const [k, v] of memSeries) if (k.includes(`|${spec(market, mode).ltf}`)) v.at = 0;
    let items;
    if (!isTd(market)) {
      const rows = await tickers();
      const all = rows.filter(r => r.symbol.endsWith('USDT')).map(r => ({ sym: r.symbol, price: +r.lastPrice, chg: +r.priceChangePercent, vol: +r.quoteVolume }))
        .filter(x => !STABLE.test(baseOf(x.sym)) && x.price > 0 && !(x.price > 0.97 && x.price < 1.03 && Math.abs(x.chg) < 0.6));
      all.sort((a, b) => b.vol - a.vol);
      knownTk = new Map(all.map(x => [x.sym, x]));
      items = all.slice(0, S.count).map(x => ({ sym: x.sym, src: 'bn', chg: x.chg }));
      for (const w of S.watch) if (!items.find(i => i.sym === w.sym)) items.push({ sym: w.sym, src: 'bn', chg: knownTk.get(w.sym)?.chg, mine: true });
    } else {
      items = S.lists[market].map(sym => ({ sym, src: 'td', mine: true }));
      // okamžite ukáž výsledky z uložených dát, potom aktualizuj
      if (!S.demo) for (const it of items) { if (map.has(it.sym)) continue; try { const r = await analyze(it, market, mode, true); if (r) { r.stale = true; map.set(it.sym, r); } } catch {} }
      if (map.size) render('list');
    }
    st.prog = [0, items.length];
    let okN = 0, lastErr = null;
    const keep = new Set(items.map(i => i.sym));
    for (const k of [...map.keys()]) if (!keep.has(k)) map.delete(k);
    const pool = isTd(market) ? 2 : 4;
    let idx = 0;
    await Promise.all(Array.from({ length: Math.min(pool, items.length) }, async () => {
      while (idx < items.length) {
        const it = items[idx++];
        try { const r = await analyze(it, market, mode); if (r) { map.set(it.sym, r); okN++; } }
        catch (e) { lastErr = e; const old = map.get(it.sym); if (!old || old.error) map.set(it.sym, { sym: it.sym, src: it.src, market, mode, mine: it.mine, error: e.message || 'Chyba', state: 'WAIT', score: 0 }); }
        st.prog[0]++;
        if (ctxKey() === ctx) { const p = $('#prog i'); if (p) p.style.width = (st.prog[0] / st.prog[1] * 100) + '%'; const tx = $('#stxt'); if (tx) tx.textContent = `Načítavam ${st.prog[0]}/${st.prog[1]}`; render('list'); }
      }
    }));
    if (!okN && lastErr) throw lastErr;
    st.last = Date.now(); st.done = true;
    handleAlerts(ctx); if (!isTd(market)) queueBacktests(ctx);
  } catch (e) { st.err = e; st.errAt = Date.now(); }
  finally { st.scanning = false; if (ctxKey() === ctx) render('all'); }
}

/* ───────── backtest ───────── */
const btKey = r => `${r.market}|${r.mode}|${r.sym}|${cfgKey(r.market)}`;
let btChain = Promise.resolve();
function ensureBT(rec) {
  const key = btKey(rec), c = BT.get(key);
  if (c) return;
  if (rec.src === 'td') { btStore(key, E.runBacktest(rec.L, rec.H, rec.hmap, spec(rec.market, rec.mode), cfg(rec.market)), rec.L); return; }
  const sp = spec(rec.market, rec.mode), entry = { pending: true };
  BT.set(key, entry);
  btChain = btChain.then(async () => {
    const [lb, hb] = await Promise.all([bnSeries(rec.sym, sp.ltf, sp.histL, 600e3), bnSeries(rec.sym, sp.htf, sp.histH, 600e3)]);
    await sleep(0);
    const now = Date.now();
    const L = E.prep(lb.filter(b => b.t + sp.ltfMs <= now)), H = E.prep(hb.filter(b => b.t + sp.htfMs <= now));
    const res = E.runBacktest(L, H, E.mapHtf(L, H, sp.ltfMs, sp.htfMs), sp, cfg(rec.market));
    res.trades.forEach(t => { t.sigT = L.t[t.si]; });
    entry.res = res;
  }).catch(e => { entry.err = e; }).then(() => { entry.pending = false; render('bt'); });
}
function queueBacktests(ctx) {
  [...mapOf(ctx).values()].filter(r => r.L && (r.state === 'BUY' || r.state === 'WATCH'))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.score - a.score).slice(0, 12).forEach(ensureBT);
}
const btOf = rec => rec && rec.L ? BT.get(btKey(rec)) || null : null;

/* ───────── upozornenia ───────── */
function handleAlerts(ctx) {
  let fresh = 0;
  for (const r of mapOf(ctx).values()) {
    if (r.state !== 'BUY' || !r.sig || r.stale) continue;
    const key = `${r.market}|${r.sym}|${r.mode}|${r.sig.ev.t}`;
    if (seen.has(key)) continue;
    seen.add(key); fresh++;
    const p = r.sig.ev.plan;
    LOG.unshift({ key, at: Date.now(), sym: r.sym, market: r.market, mode: r.mode, price: r.price, score: r.score, trigger: r.sig.ev.trigger, entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, unread: true });
    if (r.sig.age <= 1) notify(r);
  }
  if (fresh) { LOG = LOG.slice(0, 150); ls.set('tr3.log', LOG); ls.set('tr3.seen', [...seen].slice(-600)); toast(`Nový signál na nákup: ${fresh}×`); }
}
function notify(r) {
  if (!S.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const p = r.sig.ev.plan;
  const title = `KÚPIŤ ${baseOf(r.sym)} · skóre ${r.score}`;
  const opts = { body: `Vstup ${price(p.entry)} · Stop ${price(p.stop)} · TP1 ${price(p.tp1)}`, icon: 'icon-192.png', badge: 'icon-192.png', tag: r.sym };
  navigator.serviceWorker?.getRegistration().then(reg => reg ? reg.showNotification(title, opts) : new Notification(title, opts)).catch(() => {});
}

/* ───────── drobné prvky ───────── */
const ring = (score, state, size = 56) => {
  const r = (size - 7) / 2, c = 2 * Math.PI * r, h = size / 2;
  return `<svg class="ring ${size > 60 ? 'big' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="trk" cx="${h}" cy="${h}" r="${r}"/><circle class="val" stroke="url(#g${state})" cx="${h}" cy="${h}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(100, score)) / 100)}" transform="rotate(-90 ${h} ${h})"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${Math.round(score)}</text></svg>`;
};
const spark = arr => {
  if (!arr || arr.length < 2) return '';
  const mn = Math.min(...arr), mx = Math.max(...arr), w = 96, h = 28;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 2 - (v - mn) / (mx - mn || 1) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" style="stroke:${arr[arr.length - 1] >= arr[0] ? 'var(--buy)' : 'var(--avoid)'}"/></svg>`;
};
const btTag = rec => {
  const b = btOf(rec); if (!b) return '';
  if (b.pending) return '<span class="tag">backtest…</span>';
  if (!b.res) return '';
  const v = b.res.verdict, st = b.res.st;
  if (v.k === 'low') return `<span class="tag">história: ${st.n} obch.</span>`;
  return `<span class="tag ${v.k === 'good' ? 'good' : v.k === 'bad' ? 'bad' : ''}">${v.k === 'good' ? '✓' : v.k === 'bad' ? '✕' : '~'} ${R(st.avgR)} · ${st.n} obch.</span>`;
};
function card(r) {
  const name = esc(baseOf(r.sym)), unit = esc(unitOf(r));
  if (r.error) return `<a class="card s-WAIT" href="#/s/${encodeURIComponent(r.sym)}"><div class="cname"><b>${name}</b><span>${unit}</span></div><div class="hint" style="margin-top:6px">${esc(r.error)}</div></a>`;
  return `<a class="card s-${r.state}" href="#/s/${encodeURIComponent(r.sym)}">
    <div class="crow">${ring(r.score, r.state)}
      <div class="cmain"><div class="cname"><b>${name}</b><span>${unit}</span></div>
        <div style="margin-top:6px"><span class="badge ${r.state}">${STATE[r.state]}</span>${btTag(r)}</div></div>
      <div class="cprice"><b>${price(r.price)}</b><span class="chg ${r.chg >= 0 ? 'up' : 'dn'}">${pct(r.chg)}</span></div></div>
    <div class="cfoot"><div class="hint" style="flex:1">${esc(r.hint)}</div>${spark(r.spark)}</div></a>`;
}
const INDICATORS = ['EMA 21 / 50 / 200', 'Fibonacci retracement', 'Fibonacci ciele 127 / 162 %', 'Bollinger Bands', 'RSI', 'Stoch RSI', 'MACD', 'ADX / DMI', 'VWAP', 'OBV', 'Objem', 'Podpory a rezistencie', 'RSI divergencie', 'Sviečkové vzory', 'ATR stop'];

/* ───────── hlavička ───────── */
let cd = 0;
function statusInfo() {
  const st = stOf(ctxKey()), sp = spec(S.market, S.mode), td = isTd();
  if (st.scanning) return { dot: 'busy', txt: st.prog[1] ? `Načítavam ${st.prog[0]}/${st.prog[1]}` : 'Pripájam sa…' };
  if (st.err && !st.err.nokey) return { dot: 'err', txt: 'Bez spojenia' };
  if (!st.last) return { dot: '', txt: '' };
  const left = Math.max(0, Math.round((st.last + sp.every - Date.now()) / 1000));
  if (td && !usMarket()) return { dot: 'closed', txt: `${hhmm(st.last)} · trh zatvorený` };
  return { dot: 'live', txt: `${hhmm(st.last)}${S.auto ? ` · ${left >= 120 ? Math.round(left / 60) + ' min' : left + ' s'}` : ''}` };
}
function renderTop() {
  const s = statusInfo();
  $('#top').innerHTML = `<div class="row"><a class="brand" href="#/"><img src="mark.png" alt=""><b class="metal">TRADE RADAR</b></a>
    <div class="status"><span class="dot ${s.dot}"></span><span id="stxt">${s.txt}</span>
    <button class="iconbtn ${stOf(ctxKey()).scanning ? 'spin' : ''}" id="refresh" aria-label="Obnoviť"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg></button></div></div>
    ${S.demo ? '<div class="demo-ribbon"><b>DEMO režim</b> – simulované dáta, nie skutočný trh. Signály nemajú hodnotu pre reálne obchodovanie.</div>' : ''}`;
  $('#refresh').onclick = () => scan(true);
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('s/')) return { v: 'detail', sym: decodeURIComponent(h.slice(2)) };
  if (['scan', 'log', 'settings'].includes(h)) return { v: h };
  return { v: 'home' };
}
function render(part) {
  const r = route();
  if (part === 'status' || part === 'all') renderTop();
  const tab = r.v === 'detail' ? 'scan' : r.v;
  document.body.classList.toggle('is-home', r.v === 'home');
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const un = LOG.filter(x => x.unread).length, n = $('#logN'); n.hidden = !un; n.textContent = un;
  if (part === 'status') return;
  const act = document.activeElement, typing = act && act.closest && act.closest('#view') && act.tagName === 'INPUT';
  if (r.v === 'scan') { if (part !== 'status') renderScan(part === 'view'); }
  else if (r.v === 'detail') { if (part !== 'list' && !(typing && part !== 'view')) renderDetail(r.sym); }
  else if (r.v === 'home') { if (part === 'view' || (part === 'all' && !typing)) renderHome(); }
  else if (r.v === 'log') { if (part === 'view' || part === 'all') renderLog(); }
  else if (r.v === 'settings') { if (part === 'view') renderSettings(); }
}

/* ───────── uvítacie menu ───────── */
function counts(ctx) { const c = { BUY: 0, WATCH: 0, WAIT: 0, AVOID: 0 }; for (const r of mapOf(ctx).values()) if (!r.error) c[r.state]++; return c; }
function keyBox() {
  return `<div class="card pad keybox"><b>Pre ETF a akcie potrebuješ kľúč Twelve Data</b><div class="small" style="margin-top:4px">Je zadarmo: zaregistruj sa na <b>twelvedata.com</b>, skopíruj API key z dashboardu a vlož ho sem. Bezplatný plán má limit 8 požiadaviek za minútu – zoznam akcií sa preto načítava cca 1–2 minúty a ukladá sa do telefónu.</div>
    <div class="row"><input type="password" id="kIn" placeholder="API kľúč Twelve Data" autocomplete="off"><button class="btn" id="kSave">Uložiť</button></div></div>`;
}
async function testKey(k) {
  try { const j = await (await fetch(`https://api.twelvedata.com/api_usage?apikey=${encodeURIComponent(k)}`)).json(); if (j.status === 'error' || j.code) return { ok: false, msg: j.message || 'Neplatný kľúč' }; return { ok: true, msg: `Kľúč funguje · dnes použité ${j.daily_usage ?? '?'}/${j.plan_daily_limit ?? '?'}` }; }
  catch { return { ok: null, msg: 'Kľúč sa nedá overiť (bez spojenia) – uložený.' }; }
}
function bindKeyBox(after) {
  const b = $('#kSave'); if (!b) return;
  b.onclick = async () => { const k = $('#kIn').value.trim(); if (!k) return; b.disabled = true; const t = await testKey(k); b.disabled = false; toast(t.msg); if (t.ok === false) return; S.tdKey = k; save(); stOf(ctxKey()).err = null; after && after(); };
}
function renderHome() {
  const h = new Date().getHours(), greet = h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý deň' : 'Dobrý večer';
  const needKey = isTd() && !S.tdKey && !S.demo, ctx = ctxKey(), st = stOf(ctx), c = counts(ctx), sp = spec(S.market, S.mode);
  $('#view').innerHTML = `
  <section class="hero-home"><div class="mark"><img src="mark.png" alt="Trade Radar"></div>
    <div class="wordmark metal">TRADE RADAR</div>
    <div class="greet">${greet}.</div><p class="lead" style="margin:0 auto">Vyber si trh a štýl obchodovania. Radar nájde, kedy nakúpiť – so stopom, cieľmi a overením na histórii.</p></section>
  <h2 class="sec">Trh</h2>
  <div class="tiles t3" id="mk">${Object.entries(MARKETS).map(([k, m]) => `<button class="tile ${S.market === k ? 'on' : ''}" data-k="${k}"><i class="ck"></i>${ICON[k]}<div><b>${m.label}</b><span>${k === 'crypto' ? 'Binance · 24/7' : k === 'etf' ? 'SPY, QQQ, GLD…' : 'Apple, Nvidia…'}</span></div></button>`).join('')}</div>
  ${needKey ? keyBox() : ''}
  <h2 class="sec">Štýl obchodovania</h2>
  <div class="tiles t2" id="md">${Object.entries(MODES).map(([k, m]) => `<button class="tile ${S.mode === k ? 'on' : ''}" data-k="${k}"><i class="ck"></i>${ICON[k]}<div><b>${m.label}</b><span>${m.desc}<br>${spec(S.market, k).sub}</span></div></button>`).join('')}</div>
  <div style="margin-top:22px"><a class="btn primary wide" href="#/scan">Otvoriť skener · ${MARKETS[S.market].label} ${MODES[S.mode].label} <span aria-hidden="true">→</span></a></div>
  ${st.done ? `<a class="card quick" href="#/scan"><div><div class="small">Posledný sken ${hhmm(st.last)} · ${sp.sub}</div><div style="font-weight:600;margin-top:2px"><span class="up">${c.BUY} na nákup</span> · <span style="color:var(--watch)">${c.WATCH} sledovať</span> · ${c.WAIT + c.AVOID} čaká</div></div><span class="small">→</span></a>` : ''}
  <h2 class="sec">Čo radar vyhodnocuje</h2>
  <div class="inds">${INDICATORS.map(x => `<span>${x}</span>`).join('')}</div>
  <p class="foot">Nie je to investičné poradenstvo. Aplikácia nezadáva príkazy – obchoduješ sám u svojho brokera.</p>`;
  $('#mk').onclick = e => { const b = e.target.closest('.tile'); if (!b || b.dataset.k === S.market) return; S.market = b.dataset.k; save(); renderHome(); render('status'); if (!stOf(ctxKey()).done) scan(); };
  $('#md').onclick = e => { const b = e.target.closest('.tile'); if (!b || b.dataset.k === S.mode) return; S.mode = b.dataset.k; save(); renderHome(); render('status'); if (!stOf(ctxKey()).done) scan(); };
  bindKeyBox(() => { renderHome(); scan(); });
}

/* ───────── skener ───────── */
let filter = 'all';
function renderScan(full) {
  const ctx = ctxKey(), st = stOf(ctx), sp = spec(S.market, S.mode);
  const recs = [...mapOf(ctx).values()];
  const c = counts(ctx);
  const shown = recs.filter(r => filter === 'all' || (filter === 'BUY' && r.state === 'BUY') || (filter === 'WATCH' && (r.state === 'BUY' || r.state === 'WATCH')))
    .sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || ORDER[a.state] - ORDER[b.state] || b.score - a.score);
  let body;
  if (st.err && st.err.nokey) body = keyBox();
  else if (st.err && !recs.some(r => !r.error)) body = `<div class="banner"><b>Nepodarilo sa načítať trhové dáta</b>${esc(st.err.message || String(st.err))}.${isTd() ? ' Skontroluj kľúč Twelve Data a limit požiadaviek.' : ' Skontroluj internet alebo VPN (Binance nie je dostupný vo všetkých krajinách).'}
      <div class="btns"><button class="btn primary" id="retry">Skúsiť znova</button><button class="btn" id="godemo">Spustiť DEMO</button></div></div>`;
  else if (!recs.length) body = `${isTd() ? '<p class="small">Twelve Data povoľuje 8 požiadaviek za minútu – prvé načítanie trvá chvíľu, potom sa dáta ukladajú do telefónu.</p>' : ''}<div class="list">${'<div class="sk"></div>'.repeat(6)}</div>`;
  else body = `<div class="list">${shown.map(card).join('') || '<div class="empty"><b>Žiadny signál</b>Teraz nie je čo kupovať. Aj čakanie je pozícia.</div>'}</div>`;
  const prog = st.scanning && st.prog[1] ? `<div class="progress" id="prog"><i style="width:${st.prog[0] / st.prog[1] * 100}%"></i></div>` : '';
  if (!full && $('#scanbody')) { $('#scanbody').innerHTML = prog + body; $('#sumbar').innerHTML = sumHtml(c); bindScan(); return; }
  const mkt = isTd() ? `<span class="small">${usMarket() ? '● US trh otvorený' : '○ US trh zatvorený · otvára 15:30 SEČ'}</span>` : '<span class="small">● trh 24/7</span>';
  $('#view').innerHTML = `
    <div class="ctx"><a class="ctxpill" href="#/">${ICON[S.market]}${MARKETS[S.market].label} · ${MODES[S.mode].label} <small>zmeniť</small></a>${mkt}</div>
    <h1 class="title">Kedy nakúpiť</h1>
    <p class="lead">${sp.sub}. Hľadáme pullback (EMA21, Fibonacci, podpora) alebo breakout s objemom v rastúcom trende.</p>
    <div class="summary" id="sumbar">${sumHtml(c)}</div>
    <div class="chips" id="chips">${[['all', 'Všetko'], ['BUY', 'Kúpiť'], ['WATCH', 'Kúpiť + sledovať']].map(([k, t]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div id="scanbody">${prog}${body}</div>
    <form class="addrow" id="addf"><input type="search" id="addsym" placeholder="${isTd() ? 'Pridať ticker (napr. ' + (S.market === 'etf' ? 'VOO' : 'PLTR') + ')' : 'Pridať kryptomenu (napr. LINK)'}" autocapitalize="characters" autocomplete="off"><button class="btn" type="submit">Pridať</button></form>
    <p class="foot">Signály sú technická analýza, nie investičné poradenstvo. Aplikácia nezadáva príkazy.</p>`;
  $('#chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filter = b.dataset.f; render('view'); };
  $('#addf').onsubmit = addSymbol;
  bindScan();
}
const sumHtml = c => `<div class="pill buy"><b>${c.BUY}</b><span>kúpiť</span></div><div class="pill watch"><b>${c.WATCH}</b><span>sledovať</span></div><div class="pill"><b>${c.WAIT + c.AVOID}</b><span>čaká / nie</span></div>`;
function bindScan() {
  const a = $('#retry'); if (a) a.onclick = () => scan(true);
  const b = $('#godemo'); if (b) b.onclick = () => setDemo(true);
  bindKeyBox(() => { render('view'); scan(); });
}
function addSymbol(e) {
  e.preventDefault();
  const raw = $('#addsym').value.trim().toUpperCase().replace(/\s+/g, ''); if (!raw || !/^[A-Z0-9.\-]{1,15}$/.test(raw)) return;
  if (isTd()) {
    const list = S.lists[S.market];
    if (list.includes(raw)) { toast('Už je v zozname.'); return; }
    list.push(raw); save(); toast(`Pridané: ${raw}`);
  } else {
    const bn = raw.endsWith('USDT') ? raw : raw + 'USDT';
    if (!knownTk.has(bn) && !S.demo) { toast(`${raw} sa na Binance (USDT) nenašiel.`); return; }
    if (S.watch.find(x => x.sym === bn) || mapOf(ctxKey()).has(bn)) { toast('Už je v zozname.'); return; }
    S.watch.push({ sym: bn, src: 'bn' }); save(); toast(`Pridané: ${baseOf(bn)}`);
  }
  $('#addsym').value = ''; scan();
}
function setDemo(on) { S.demo = on; save(); M.clear(); CS.clear(); BT.clear(); cache.clear(); memSeries.clear(); render('all'); render('view'); scan(); }

/* ───────── detail ───────── */
function renderDetail(sym) {
  const r = mapOf(ctxKey()).get(sym), v = $('#view');
  const back = '<a class="back" href="#/scan">← Skener</a>';
  if (!r || r.error) { v.innerHTML = back + `<div class="empty"><b>${esc(baseOf(sym))}</b>${r && r.error ? esc(r.error) : (stOf(ctxKey()).scanning || !stOf(ctxKey()).done ? 'Načítavam…' : 'Symbol nie je v aktuálnom skeneri.')}</div>`; return; }
  ensureBT(r);
  const sp = spec(r.market, r.mode), ev = r.lv.ev, p = ev.plan, bt = btOf(r), res = bt && bt.res;
  const sig = r.sig, isBuy = r.state === 'BUY' && !!sig;
  const age = sig ? (sig.age === 0 ? 'práve vznikol' : `vznikol pred ${sig.age} sviečk${sig.age === 1 ? 'ou' : 'ami'}`) : '';
  const warnBt = isBuy && res && res.verdict.k === 'bad' ? '<div class="warn">⚠ Na tomto symbole stratégia v histórii nefungovala. Ber to ako slabší signál alebo ho preskoč.</div>'
    : isBuy && res && res.verdict.k === 'low' ? '<div class="warn">ℹ História tohto symbolu má málo obchodov – overenie je len orientačné.</div>' : '';
  const own = r.src === 'bn' ? S.watch.find(x => x.sym === sym) : true;
  v.innerHTML = `${back}
  <div class="dhead"><div><h1>${esc(baseOf(sym))}</h1><span class="small">${esc(MARKETS[r.market].label)} · ${MODES[r.mode].label} · ${sp.sub}${r.stale ? ' · uložené dáta' : ''}</span></div>
    <div class="p"><b>${price(r.price)}</b><span class="chg ${r.chg >= 0 ? 'up' : 'dn'}">${pct(r.chg)} dnes</span></div></div>
  <div class="dgrid"><div class="dcol">
    <div class="card pad s-${r.state}"><div class="hero">${ring(r.score, r.state, 84)}
      <div><span class="badge ${r.state}">${STATE[r.state]}</span>${btTag(r)}<p>${esc(r.hint)}${sig ? ` <span class="small">(${age})</span>` : ''}</p></div></div>${warnBt}</div>
    ${isBuy ? planCard(r, p, ev) : ''}
    ${isBuy ? `<div class="card pad" id="calc">${calcHtml(r, p)}</div>` : ''}
    <div class="card pad"><h2 class="sec" style="margin-top:0">Analýza · ${ev.score}/100</h2>
      ${ev.groups.map(g => `<div class="grp"><div class="grph">${g.name}<em>${g.pts} / ${g.max}</em></div><div class="bar"><i style="width:${g.pts / g.max * 100}%"></i></div>
        <ul class="checks">${g.items.map(c => `<li class="${c.ok === true ? 'y' : c.ok === false ? 'n' : 'u'}"><i>${c.ok === true ? '✓' : c.ok === false ? '✕' : '–'}</i><div>${esc(c.label)}<span>${esc(c.detail)}</span></div></li>`).join('')}</ul></div>`).join('')}
      <p class="small" style="margin-top:12px">Skóre meria <b>zhodu podmienok</b>, nie pravdepodobnosť zisku – tú ukazuje backtest. „KÚPIŤ“ vyžaduje rastúci vyšší timeframe, spúšťač vstupu a skóre ≥ ${S.strict}${Object.values(S.filters).some(Boolean) ? ' + zapnuté povinné filtre' : ''}.</p></div>
    ${levelsCard(r, ev)}
  </div><div class="dcol">
    <div class="card pad"><h2 class="sec" style="margin-top:0">Graf · ${r.L === undefined ? '' : sp.ltf === '1h' ? '1 hodina' : '15 minút'}</h2>
      <div class="ovs" id="ovs">${[['ema', 'EMA'], ['bb', 'Bollinger'], ['fib', 'Fibonacci'], ['vwap', 'VWAP'], ['sr', 'S/R']].map(([k, t]) => `<button data-ov="${k}" class="${S.ov[k] ? 'on' : ''}">${t}</button>`).join('')}<span class="gap"></span>${[['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stoch RSI'], ['vol', 'Objem']].map(([k, t]) => `<button data-sub="${k}" class="${S.sub === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="readout" id="readout"></div><canvas class="chart" id="chart"></canvas>
      <div class="legend"><span><i style="background:#d8c39a"></i>EMA21</span><span><i style="background:#8f9bb8"></i>EMA50</span>${isBuy ? '<span><i style="background:var(--buy)"></i>vstup / ciele</span><span><i style="background:var(--avoid)"></i>stop</span>' : ''}<span>▲ historické signály</span></div></div>
    ${fibCard(ev)}
    <div class="card pad" id="btbox">${btHtml(r, bt)}</div>
    ${own ? `<button class="btn danger sm" id="rm">Odstrániť ${esc(baseOf(sym))} zo zoznamu</button>` : ''}
  </div></div>
  <p class="foot">Nie je to investičné poradenstvo. Minulé výsledky nezaručujú budúce. Obchody zadávaš a riadiš sám.</p>`;
  const rm = $('#rm'); if (rm) rm.onclick = () => { if (r.src === 'bn') S.watch = S.watch.filter(x => x.sym !== sym); else S.lists[r.market] = S.lists[r.market].filter(x => x !== sym); save(); mapOf(ctxKey()).delete(sym); location.hash = '#/scan'; };
  $('#ovs').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.ov) S.ov[b.dataset.ov] = !S.ov[b.dataset.ov]; else S.sub = b.dataset.sub; save(); $$('#ovs button').forEach(x => x.classList.toggle('on', x.dataset.ov ? !!S.ov[x.dataset.ov] : S.sub === x.dataset.sub)); chart.draw(null); };
  bindCalc(r, p);
  setupChart(r, ev, isBuy ? p : null, res);
  drawEquity(res);
}
function planCard(r, p, ev) {
  const sp = spec(r.market, r.mode), zoneLo = p.entry - 0.3 * p.risk, zoneHi = p.entry + 0.3 * p.risk;
  const zTxt = r.price > zoneHi ? 'cena je nad zónou – opatrne' : r.price < zoneLo ? 'cena je pod zónou – stop stále platí' : 'cena je v zóne';
  const pc = x => pct((x / p.entry - 1) * 100, 1);
  const fe = ev.fib ? ev.fib.ext.filter(x => x.p > p.entry) : [];
  return `<div class="card pad s-BUY"><h2 class="sec" style="margin-top:0">Obchodný plán</h2><div class="kv">
    <span class="k">Vstup</span><span class="s">${zTxt}</span><span class="v big">${price(zoneLo)} – ${price(zoneHi)}</span>
    <span class="k">Stop loss</span><span class="s">−${nf((p.entry - p.stop) / p.entry * 100, 1)} %</span><span class="v dn big">${price(p.stop)}</span>
    <span class="k">TP1 · 1,5R</span><span class="s">${pc(p.tp1)} · predaj ½, stop na vstup</span><span class="v up">${price(p.tp1)}</span>
    <span class="k">TP2 · 3R</span><span class="s">${pc(p.tp2)} · zvyšok</span><span class="v up">${price(p.tp2)}</span>
    ${fe.map(x => `<span class="k">Fib ${nf(x.r * 100, 1)} %</span><span class="s">${pc(x.p)} · alternatívny cieľ</span><span class="v" style="color:var(--gold)">${price(x.p)}</span>`).join('')}
    <span class="k">Max. držanie</span><span class="s">ak sa nič nestane</span><span class="v">~${sp.hold}</span></div>
    <div class="sep"></div><p class="small">Stop je pod posledným swing low (1–3× ATR). Ak cena zavrie pod stopom, plán padá – nepridávaj a neposúvaj stop nižšie.</p></div>`;
}
function levelsCard(r, ev) {
  const L = r.L, i = L.n - 1, H = r.H, hj = r.hmap[i];
  const row = (k, s, v) => `<span class="k">${k}</span><span class="s">${s}</span><span class="v">${v}</span>`;
  return `<div class="card pad"><h2 class="sec" style="margin-top:0">Kľúčové úrovne</h2><div class="kv">
    ${row('Rezistencia', 'najbližší swing high', isFinite(ev.sr.res) ? price(ev.sr.res) : '—')}
    ${row('Podpora', 'najbližší swing low', isFinite(ev.sr.sup) ? price(ev.sr.sup) : '—')}
    ${row('EMA21', 'zóna nákupu', price(L.ema21[i]))}
    ${row('EMA50', 'pod ňou trend slabne', price(L.ema50[i]))}
    ${row('VWAP', 'priemerná cena dňa', price(L.vwap[i]))}
    ${row('Bollinger', 'dolné / horné pásmo', `${price(L.bbL[i])} / ${price(L.bbU[i])}`)}
    ${row('ATR(14)', 'typický pohyb sviečky', price(L.atr[i]))}
    ${row('RSI · Stoch RSI', ev.rsi >= 70 ? 'prekúpené' : ev.rsi <= 30 ? 'prepredané' : 'neutrálne', `${nf(ev.rsi, 0)} · ${isFinite(L.stK[i]) ? nf(L.stK[i], 0) : '—'}`)}
    ${row('ADX (vyšší TF)', H.adx[hj] >= 25 ? 'silný trend' : H.adx[hj] >= 20 ? 'trend' : 'slabý / bočný trh', isFinite(H.adx[hj]) ? nf(H.adx[hj], 0) : '—')}
  </div></div>`;
}
function fibCard(ev) {
  const f = ev.fib;
  if (!f) return `<div class="card pad"><h2 class="sec" style="margin-top:0">Fibonacci</h2><p class="small">Za posledných 120 sviečok nie je dosť výrazný rastový pohyb na meranie retracementu.</p></div>`;
  const hit = f.levels.reduce((a, b) => Math.abs(b.r - f.deep) < Math.abs(a.r - f.deep) ? b : a);
  return `<div class="card pad"><h2 class="sec" style="margin-top:0">Fibonacci retracement</h2>
    <p class="small" style="margin:0">Vlna ${price(f.lo)} → ${price(f.hi)}. Pullback siahol na <b style="color:var(--text)">${nf(f.deep * 100, 1)} %</b>${f.inZone ? ' – v zóne 38,2–61,8 %, kde sa často kupuje.' : f.deep < 0.3 ? ' – plytký, trh zatiaľ nekorigoval.' : ' – mimo ideálnej zóny.'}</p>
    <div class="fibt">${f.levels.filter(x => x.r > 0 && x.r < 1).map(x => `<div class="${x === hit ? 'hit' : ''}">${nf(x.r * 100, 1)} %<b>${price(x.p)}</b></div>`).join('')}${f.ext.map(x => `<div>cieľ ${nf(x.r * 100, 1)} %<b>${price(x.p)}</b></div>`).join('')}</div></div>`;
}
function calcHtml(r, p) {
  const entry = r.price, sp = E.sizing(S.account, S.risk, entry, p.stop, S.cost[r.market]);
  if (!sp) return '';
  const cap = sp.notional > S.account, qty = cap ? S.account / entry : sp.qty, notional = qty * entry, realRisk = qty * (entry - p.stop);
  const whole = r.src === 'td', q = whole ? Math.floor(qty) : qty;
  return `<h2 class="sec" style="margin-top:0">Koľko kúpiť</h2>
  <div class="calc"><div><label>Účet</label><input type="number" inputmode="decimal" id="cAcc" value="${S.account}" min="0"></div>
  <div><label>Riziko (%)</label><input type="number" inputmode="decimal" id="cRisk" value="${S.risk}" min="0.1" max="10" step="0.1"></div>
  <div><label>Mena</label><input type="text" id="cCur" value="${esc(S.cur)}" maxlength="4"></div></div>
  <div class="calcout">Riskuješ <b>${money(realRisk)}</b>. Kúp za <b>${money(notional)}</b> (${nf(notional / S.account * 100, 0)} % účtu) = <b>${qtyFmt(qty)} ${esc(baseOf(r.sym))}</b>${whole && q !== qty ? ` <span class="small">(celé kusy: ${q}, pri XTB ide aj zlomok)</span>` : ''}. Náklady tam a späť ≈ ${money(notional * S.cost[r.market] / 100 * 2)}.
  ${cap ? `<br><span class="small" style="color:var(--gold)">Pri tomto stope by pozícia presiahla účet – je orezaná na celý účet, reálne riskuješ menej než ${nf(S.risk, 1)} %. Páku nepoužívaj.</span>` : ''}</div>`;
}
function bindCalc(r, p) {
  const upd = () => { S.account = Math.max(0, +$('#cAcc').value || 0); S.risk = Math.min(10, Math.max(0.1, +$('#cRisk').value || 1)); S.cur = $('#cCur').value || '€'; save();
    const tmp = document.createElement('div'); tmp.innerHTML = calcHtml(r, p); const o = $('.calcout'), n = $('.calcout', tmp); if (o && n) o.innerHTML = n.innerHTML; };
  ['#cAcc', '#cRisk', '#cCur'].forEach(s => { const e = $(s); if (e) e.oninput = upd; });
}
function btHtml(r, bt) {
  const sp = spec(r.market, r.mode), head = '<h2 class="sec" style="margin-top:0">Overenie na histórii</h2>';
  if (!bt || bt.pending) return head + `<div class="sk" style="height:120px"></div><p class="small" style="margin-top:10px">Sťahujem históriu a spätne simulujem rovnaké pravidlá…</p>`;
  if (bt.err || !bt.res) return head + `<p class="small">Backtest sa nepodarilo spustiť (${esc(bt.err ? bt.err.message : 'málo dát')}).</p>`;
  const x = bt.res, st = x.st, v = x.verdict, o = x.oos, days = Math.round((x.to - x.from) / 864e5);
  if (!st.n) return head + `<p class="small">Za ${days} dní pravidlá na tomto symbole nevygenerovali žiadny obchod${Object.values(S.filters).some(Boolean) ? ' (skús vypnúť povinné filtre)' : ''}.</p>`;
  const rows = x.trades.filter(t => !t.open).slice(-8).reverse(), rl = { TP2: 'TP2', BE: 'break-even', SL: 'stop', TIME: 'čas' };
  return head + `<span class="tag ${v.k === 'good' ? 'good' : v.k === 'bad' ? 'bad' : ''}" style="margin:0">${esc(v.text)}</span>
  <p class="small" style="margin:8px 0 0">Rovnaké pravidlá spätne za ${days} dní (${dmy(x.from)} – ${dmy(x.to)}). Cena samotná za obdobie: ${pct(x.bh * 100, 0)}.</p>
  <div class="kpis"><div class="kpi"><span>Obchody</span><b>${st.n}</b></div><div class="kpi"><span>Úspešnosť</span><b>${nf(st.winRate * 100, 0)} %</b></div><div class="kpi"><span>Priemer</span><b class="${st.avgR >= 0 ? 'up' : 'dn'}">${R(st.avgR)}</b></div>
  <div class="kpi"><span>Profit factor</span><b>${isFinite(st.pf) ? nf(st.pf, 2) : '∞'}</b></div><div class="kpi"><span>Max. pokles</span><b>−${nf(st.maxDD, 1)}R</b></div><div class="kpi"><span>Spolu</span><b class="${st.totalR >= 0 ? 'up' : 'dn'}">${R(st.totalR)}</b></div></div>
  <canvas id="eq" style="width:100%;height:110px;display:block"></canvas>
  <p class="small" style="margin-top:8px">Posledných 30 % obdobia: ${o.n ? `${o.n} obchodov, priemer ${R(o.avgR)}` : 'bez obchodov'}.</p>
  <table class="tr"><tr><th>Signál</th><th>Koniec</th><th>Výsledok</th></tr>${rows.map(t => `<tr><td>${dmy(t.t)} ${hhmm(t.t)} · ${t.trig === 'pullback' ? 'pullback' : 'breakout'}</td><td>${rl[t.reason] || t.reason} · ${t.bars} sv.</td><td class="${t.r >= 0 ? 'up' : 'dn'}">${R(t.r)}</td></tr>`).join('')}</table>
  <p class="small" style="margin-top:10px">1R = vzdialenosť vstup–stop. Vstup na otvorení ďalšej sviečky, náklady ${nf(S.cost[r.market], 2)} % na stranu, pri stope aj cieli v jednej sviečke počítame stop, TP1 = ½ pozície + stop na vstup, časový stop ${sp.maxBars} sviečok. Swap/financovanie nie je započítané.</p>`;
}

/* ───────── graf ───────── */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const chart = { draw() {} };
function setupChart(r, ev, plan, res) {
  const cv = $('#chart'); if (!cv) return;
  const L = r.L, nVis = Math.min(window.innerWidth < 600 ? 84 : 130, L.n), s0 = L.n - nVis;
  const idx = new Map(); for (let i = s0; i < L.n; i++) idx.set(L.t[i], i);
  const marks = res ? res.trades.map(t => idx.get(t.sigT)).filter(i => i !== undefined) : [];
  const C = { buy: css('--buy'), red: css('--avoid'), dim: css('--dim'), mute: css('--mute'), text: css('--text'), gold: '#d8c39a', e50: '#8f9bb8', watch: css('--watch') };
  const draw = hover => {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const pl = 2, pr = 62, pt = 8, mainB = h - 118, subT = h - 92, subB = h - 6, pw = w - pl - pr, bw = pw / nVis;
    let mn = Infinity, mx = -Infinity;
    for (let i = s0; i < L.n; i++) { mn = Math.min(mn, L.l[i]); mx = Math.max(mx, L.h[i]); }
    const span0 = mx - mn;
    if (plan) { mn = Math.min(mn, plan.stop); mx = Math.max(mx, plan.tp1); if (plan.tp2 - mx < span0 * 0.25) mx = Math.max(mx, plan.tp2); }
    const pad = (mx - mn) * 0.06; mn -= pad; mx += pad;
    const Y = v => pt + (1 - (v - mn) / (mx - mn)) * (mainB - pt), X = i => pl + (i - s0 + 0.5) * bw;
    g.font = '10.5px "Inter Tight", Inter, sans-serif'; g.textBaseline = 'middle';
    // mriežka
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, y = Y(v); g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + pw, y); g.stroke(); g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(price(v), pl + pw + 6, y); }
    for (let k = 0; k < 3; k++) { const i = s0 + Math.round((nVis - 1) * k / 2); g.fillStyle = C.dim; g.textAlign = k === 2 ? 'right' : k === 0 ? 'left' : 'center'; g.fillText(`${dmy(L.t[i])} ${hhmm(L.t[i])}`, X(i), mainB + 12); }
    g.save(); g.beginPath(); g.rect(pl, pt, pw, mainB - pt); g.clip();
    // objem (slabé stĺpce)
    let vmax = 0; for (let i = s0; i < L.n; i++) vmax = Math.max(vmax, L.v[i]);
    for (let i = s0; i < L.n; i++) { const vh = (L.v[i] / (vmax || 1)) * (mainB - pt) * 0.16; g.fillStyle = L.c[i] >= L.o[i] ? 'rgba(52,211,153,.13)' : 'rgba(248,113,113,.13)'; g.fillRect(X(i) - bw * 0.36, mainB - vh, bw * 0.72, vh); }
    const line = (arr, col, wd = 1.4, dash) => { g.strokeStyle = col; g.lineWidth = wd; if (dash) g.setLineDash(dash); g.beginPath(); let st = false; for (let i = s0; i < L.n; i++) { if (!isFinite(arr[i])) { st = false; continue; } const x = X(i), y = Y(arr[i]); st ? g.lineTo(x, y) : (g.moveTo(x, y), st = true); } g.stroke(); g.setLineDash([]); };
    if (S.ov.bb) {
      g.fillStyle = 'rgba(152,168,255,.06)'; g.beginPath(); let f = true;
      for (let i = s0; i < L.n; i++) if (isFinite(L.bbU[i])) { f ? g.moveTo(X(i), Y(L.bbU[i])) : g.lineTo(X(i), Y(L.bbU[i])); f = false; }
      for (let i = L.n - 1; i >= s0; i--) if (isFinite(L.bbL[i])) g.lineTo(X(i), Y(L.bbL[i]));
      g.fill(); line(L.bbU, 'rgba(152,168,255,.45)', 1); line(L.bbL, 'rgba(152,168,255,.45)', 1); line(L.bbM, 'rgba(152,168,255,.25)', 1, [2, 3]);
    }
    if (S.ov.fib && ev.fib) {
      const f = ev.fib, x0 = Math.max(pl, X(Math.max(s0, f.loI)));
      const yA = Y(f.hi - f.rng * 0.5), yB = Y(f.hi - f.rng * 0.618);
      g.fillStyle = 'rgba(216,195,154,.08)'; g.fillRect(x0, yA, pl + pw - x0, yB - yA);
      for (const lv of f.levels) { const y = Y(lv.p); g.strokeStyle = 'rgba(216,195,154,' + (lv.r === 0.618 || lv.r === 0.5 ? '.6' : '.3') + ')'; g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(pl + pw, y); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(216,195,154,.85)'; g.textAlign = 'left'; g.fillText(nf(lv.r * 100, 1) + ' %', x0 + 3, y - 6); }
    }
    if (S.ov.sr) for (const [v, col] of [[ev.sr.res, C.red], [ev.sr.sup, C.buy]]) { if (!isFinite(v)) continue; const y = Y(v); g.strokeStyle = col; g.globalAlpha = .35; g.lineWidth = 6; g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + pw, y); g.stroke(); g.globalAlpha = 1; }
    if (S.ov.vwap) line(L.vwap, 'rgba(255,255,255,.55)', 1.2, [4, 3]);
    // sviečky
    for (let i = s0; i < L.n; i++) {
      const col = L.c[i] >= L.o[i] ? C.buy : C.red, x = X(i);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(L.h[i])); g.lineTo(x, Y(L.l[i])); g.stroke();
      const y1 = Y(Math.max(L.o[i], L.c[i])), y2 = Y(Math.min(L.o[i], L.c[i])); g.fillRect(x - bw * 0.34, y1, bw * 0.68, Math.max(1, y2 - y1));
    }
    if (S.ov.ema) { line(L.ema50, C.e50, 1.5); line(L.ema21, C.gold, 1.5); }
    if (plan) for (const [v, col, lb] of [[plan.tp2, C.buy, 'TP2'], [plan.tp1, C.buy, 'TP1'], [plan.entry, C.text, 'vstup'], [plan.stop, C.red, 'stop']]) {
      if (v < mn || v > mx) continue; const y = Y(v); g.strokeStyle = col; g.globalAlpha = .9; g.setLineDash([5, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + pw, y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = col; g.textAlign = 'right'; g.fillText(lb, pl + pw - 4, y - 7);
    }
    g.fillStyle = '#f2e6c9';
    for (const i of marks) { const x = X(i), y = Y(L.l[i]) + 10; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x - 4.5, y + 3); g.lineTo(x + 4.5, y + 3); g.closePath(); g.fill(); }
    g.restore();
    // podgraf
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(pl, subT - 4); g.lineTo(pl + pw, subT - 4); g.stroke();
    const sub = S.sub, SY = (v, a, b) => subT + (1 - (v - a) / (b - a)) * (subB - subT);
    const sline = (arr, a, b, col, wd = 1.3) => { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); let st = false; for (let i = s0; i < L.n; i++) { if (!isFinite(arr[i])) { st = false; continue; } const x = X(i), y = SY(arr[i], a, b); st ? g.lineTo(x, y) : (g.moveTo(x, y), st = true); } g.stroke(); };
    const ref = (v, a, b) => { const y = SY(v, a, b); g.strokeStyle = 'rgba(255,255,255,.1)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + pw, y); g.stroke(); g.setLineDash([]); g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(String(v), pl + pw + 6, y); };
    const li = hover ?? L.n - 1; let lbl = '';
    if (sub === 'rsi') { ref(70, 0, 100); ref(30, 0, 100); sline(L.rsi, 0, 100, C.watch, 1.5); lbl = `RSI 14 · ${nf(L.rsi[li], 0)}`; }
    else if (sub === 'stoch') { ref(80, 0, 100); ref(20, 0, 100); sline(L.stK, 0, 100, C.watch, 1.4); sline(L.stD, 0, 100, C.gold, 1.2); lbl = `Stoch RSI · K ${isFinite(L.stK[li]) ? nf(L.stK[li], 0) : '—'} / D ${isFinite(L.stD[li]) ? nf(L.stD[li], 0) : '—'}`; }
    else if (sub === 'macd') {
      let am = 0; for (let i = s0; i < L.n; i++) am = Math.max(am, Math.abs(L.macd[i] || 0), Math.abs(L.macdSig[i] || 0), Math.abs(L.hist[i] || 0));
      am = am || 1; const z = SY(0, -am, am);
      for (let i = s0; i < L.n; i++) { const hv = L.hist[i]; if (!isFinite(hv)) continue; g.fillStyle = hv >= 0 ? 'rgba(52,211,153,.55)' : 'rgba(248,113,113,.55)'; const y = SY(hv, -am, am); g.fillRect(X(i) - bw * 0.34, Math.min(y, z), bw * 0.68, Math.abs(y - z)); }
      sline(L.macd, -am, am, C.watch); sline(L.macdSig, -am, am, C.gold, 1.1); lbl = `MACD · histogram ${isFinite(L.hist[li]) ? (L.hist[li] >= 0 ? '+' : '−') + price(Math.abs(L.hist[li])) : '—'}`;
    } else {
      let vm = 0; for (let i = s0; i < L.n; i++) vm = Math.max(vm, L.v[i]);
      for (let i = s0; i < L.n; i++) { g.fillStyle = L.c[i] >= L.o[i] ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)'; const y = SY(L.v[i], 0, vm || 1); g.fillRect(X(i) - bw * 0.34, y, bw * 0.68, subB - y); }
      sline(L.vsma, 0, vm || 1, C.gold, 1.2); lbl = `Objem · ${nf(L.v[li] / (L.vsma[li] || L.v[li] || 1), 1)}× priemeru`;
    }
    g.textAlign = 'left'; const lw = g.measureText(lbl).width; g.fillStyle = 'rgba(10,10,14,.75)'; g.fillRect(pl, subT - 2, lw + 10, 16); g.fillStyle = C.mute; g.fillText(lbl, pl + 5, subT + 6);
    if (hover != null) { const x = X(hover); g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, subB); g.stroke(); g.setLineDash([]); }
    cv._geo = { pl, bw, s0, n: nVis };
  };
  const ro = $('#readout');
  const show = i => { ro.innerHTML = i == null ? `Posledná uzavretá sviečka ${dmy(L.t[L.n - 1])} ${hhmm(L.t[L.n - 1])} · ťukni do grafu pre detail` : `${dmy(L.t[i])} ${hhmm(L.t[i])} · O ${price(L.o[i])} · H ${price(L.h[i])} · L ${price(L.l[i])} · C <b style="color:var(--text)">${price(L.c[i])}</b>`; };
  const at = e => { const g = cv._geo, x = (e.clientX - cv.getBoundingClientRect().left - g.pl) / g.bw; return Math.max(g.s0, Math.min(g.s0 + g.n - 1, g.s0 + Math.floor(x))); };
  cv.onpointermove = cv.onpointerdown = e => { const i = at(e); draw(i); show(i); };
  cv.onpointerleave = () => { draw(null); show(null); };
  chart.draw = h => { draw(h); show(h); };
  draw(null); show(null);
}
function drawEquity(res) {
  const cv = $('#eq'); if (!cv || !res || !res.st.curve) return;
  const c = res.st.curve, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const mn = Math.min(0, ...c), mx = Math.max(0.001, ...c), Y = v => 6 + (1 - (v - mn) / (mx - mn)) * (h - 12), X = i => i / Math.max(1, c.length - 1) * (w - 4) + 2;
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke(); g.setLineDash([]);
  const col = c[c.length - 1] >= 0 ? '#34d399' : '#f87171';
  g.beginPath(); c.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
  g.lineTo(X(c.length - 1), Y(0)); g.lineTo(X(0), Y(0)); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col + '44'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fill();
}

/* ───────── signály ───────── */
function renderLog() {
  $('#view').innerHTML = `<h1 class="title">Signály</h1><p class="lead">História nákupných signálov, ktoré radar zachytil, kým bola aplikácia otvorená.</p>` +
    (LOG.length ? `<div class="list">${LOG.map(x => `<a class="card logi" href="#/s/${encodeURIComponent(x.sym)}" data-m="${x.market || 'crypto'}" data-d="${x.mode}"><div class="cmain"><div class="cname"><b>${esc(baseOf(x.sym))}</b><span>${MARKETS[x.market || 'crypto'].label} · ${MODES[x.mode].label} · ${x.trigger}</span>${x.unread ? '<span class="tag good">nové</span>' : ''}</div>
      <div class="t">${dmy(x.at)} ${hhmm(x.at)} · skóre ${x.score}</div></div><div class="cprice"><b>${price(x.entry)}</b><span class="small">SL ${price(x.stop)} · TP1 ${price(x.tp1)}</span></div></a>`).join('')}</div><div class="btns"><button class="btn sm" id="clrlog">Vymazať históriu</button></div>`
      : '<div class="empty"><b>Zatiaľ nič</b>Keď radar nájde nákupný signál, zapíše sa sem.</div>') +
    `<p class="foot">Aplikácia kontroluje trh, kým je otvorená. Upozornenia pri úplne zatvorenej aplikácii by vyžadovali vlastný server.</p>`;
  $$('.logi').forEach(a => a.onclick = () => { if (S.market !== a.dataset.m || S.mode !== a.dataset.d) { S.market = a.dataset.m; S.mode = a.dataset.d; save(); if (!stOf(ctxKey()).done) scan(); } });
  const c = $('#clrlog'); if (c) c.onclick = () => { LOG = []; ls.set('tr3.log', LOG); renderLog(); render('status'); };
  if (LOG.some(x => x.unread)) { LOG.forEach(x => x.unread = false); ls.set('tr3.log', LOG); const n = $('#logN'); n.hidden = true; }
}

/* ───────── nastavenia ───────── */
const FILTERS = [
  ['adx', 'Silný trend (ADX ≥ 20)', 'Kupuje len keď je trend na vyššom TF dostatočne silný. Menej signálov v bočnom trhu.'],
  ['fib', 'Pullback do Fibonacciho zóny', 'Pullback musí siahnuť na 38,2–61,8 % posledného pohybu. Breakouty platia aj bez neho.'],
  ['vwap', 'Cena nad VWAP', 'Kupujúci musia mať navrch voči priemernej cene dňa.'],
  ['obv', 'Akumulácia (OBV)', 'Objem musí potvrdzovať nákupy.'],
  ['candle', 'Sviečkový vzor', 'Vyžaduje bullish engulfing alebo kladivo. Najprísnejší filter.']
];
function renderSettings() {
  const sw = (id, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></label>`;
  const listBox = m => `<div class="srow col"><div><div class="t">${MARKETS[m].label}</div><div class="d">Symboly v skeneri. Nové pridáš v skeneri alebo tu.</div></div>
    <div class="wl">${S.lists[m].map(s => `<span>${esc(s)}<button data-rml="${m}" data-s="${esc(s)}" aria-label="Odstrániť">×</button></span>`).join('')}</div>
    <form class="addrow" data-addl="${m}" style="margin-top:10px"><input type="text" placeholder="Ticker" autocapitalize="characters"><button class="btn sm">Pridať</button></form></div>`;
  $('#view').innerHTML = `<h1 class="title">Nastavenia</h1><p class="lead">Riziko, presnosť signálov, dáta a vzhľad.</p>
  <h2 class="sec">Účet a riziko</h2><div class="card pad">
    <div class="srow"><div><div class="t">Veľkosť účtu</div><div class="d">Na výpočet veľkosti pozície.</div></div><input type="number" inputmode="decimal" id="sAcc" value="${S.account}"></div>
    <div class="srow"><div><div class="t">Mena účtu</div></div><input type="text" id="sCur" value="${esc(S.cur)}" maxlength="4"></div>
    <div class="srow"><div><div class="t">Riziko na obchod (%)</div><div class="d">Koľko % účtu stratíš, ak padne stop. Bežne 0,5–2 %.</div></div><input type="number" inputmode="decimal" step="0.1" id="sRisk" value="${S.risk}"></div>
    <div class="srow"><div><div class="t">Náklady – krypto (% na stranu)</div><div class="d">Poplatok + slippage. Binance spot ≈ 0,1 %.</div></div><input type="number" inputmode="decimal" step="0.01" id="sCostC" value="${S.cost.crypto}"></div>
    <div class="srow"><div><div class="t">Náklady – akcie a ETF (% na stranu)</div><div class="d">Spread + prípadná konverzia meny (napr. XTB 0,5 % pri EUR účte).</div></div><input type="number" inputmode="decimal" step="0.01" id="sCostS" value="${S.cost.stock}"></div>
  </div>
  <h2 class="sec">Presnosť signálov</h2><div class="card pad">
    <div class="srow col"><div><div class="t">Prísnosť</div><div class="d">Minimálne skóre pre „KÚPIŤ“. Prísnejšie = menej, ale kvalitnejších signálov.</div></div>
      <div class="seg" id="sStrict">${[[60, 'Aktívna 60'], [70, 'Vyvážená 70'], [80, 'Prísna 80']].map(([v, t]) => `<button data-v="${v}" class="${S.strict === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    ${FILTERS.map(([k, t, d]) => `<div class="srow"><div><div class="t">${t}</div><div class="d">${d}</div></div>${sw('f_' + k, S.filters[k])}</div>`).join('')}
    <p class="small" style="margin:10px 0 0">Tip: zapni filter a pozri si backtest pri symboloch. Uvidíš, či na danom trhu výsledky zlepšuje, alebo len uberá obchody.</p>
  </div>
  <h2 class="sec">Skener</h2><div class="card pad">
    <div class="srow col"><div><div class="t">Počet kryptomien</div><div class="d">Najobchodovanejšie USDT páry na Binance.</div></div>
      <div class="seg" id="sCount">${[10, 20, 30].map(v => `<button data-v="${v}" class="${S.count === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <div class="srow"><div><div class="t">Automatická aktualizácia</div><div class="d">Krypto každých 90 s, akcie/ETF každých 5–10 min počas obchodných hodín.</div></div>${sw('sAuto', S.auto)}</div>
    <div class="srow"><div><div class="t">Upozornenia</div><div class="d">Systémové upozornenie pri novom signáli „KÚPIŤ“ (kým aplikácia beží).</div></div>${sw('sNotify', S.notify)}</div>
  </div>
  <h2 class="sec">Akcie a ETF</h2><div class="card pad">
    <div class="srow col"><div><div class="t">Kľúč Twelve Data</div><div class="d">Zadarmo na twelvedata.com. Zostáva len v tomto zariadení.</div></div>
      <div class="addrow" style="margin-top:10px"><input type="password" id="sKey" value="${esc(S.tdKey)}" placeholder="API kľúč" autocomplete="off"><button class="btn sm" id="sKeyT">Overiť a uložiť</button></div></div>
    ${listBox('etf')}${listBox('stock')}
  </div>
  <h2 class="sec">Vzhľad</h2><div class="card pad">
    <div class="srow col"><div><div class="t">Téma</div><div class="d">Ultimate – čierna s farebnou aurou. Platinum – grafit so striebornými odleskami.</div></div>
      <div class="seg" id="sTheme">${[['ultimate', 'Ultimate'], ['platinum', 'Platinum']].map(([v, t]) => `<button data-v="${v}" class="${S.theme === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="srow"><div><div class="t">Pohyblivé pozadie</div><div class="d">Vypni, ak chceš šetriť batériu.</div></div>${sw('sMotion', S.motion)}</div>
  </div>
  <h2 class="sec">Ostatné</h2><div class="card pad">
    <div class="srow"><div><div class="t">DEMO režim</div><div class="d">Simulované dáta na vyskúšanie. Nie je to skutočný trh.</div></div>${sw('sDemo', S.demo)}</div>
    <div class="srow"><div><div class="t">Vymazať dáta aplikácie</div><div class="d">Nastavenia, históriu signálov a uložené sviečky.</div></div><button class="btn danger sm" id="sWipe">Vymazať</button></div>
  </div>
  <p class="foot"><b>Ako radar rozhoduje.</b> Vyšší timeframe musí rásť (EMA50 stúpa, cena nad ňou, ideálne ADX ≥ 20). Na nižšom timeframe hľadá vstup: pullback do zóny hodnoty (EMA21, Fibonacci 38–62 %, podpora alebo dolné Bollinger pásmo) s odrazom, alebo breakout nad 20-sviečkové maximum s objemom. Skóre 0–100 sčíta trend (25), štruktúru a OBV (15), vstup a konfluenciu (25), momentum – MACD, RSI, Stoch RSI, divergencie (15), objem a VWAP (10) a priestor do rezistencie (10). Stop je pod swing low podľa ATR, ciele 1,5R a 3R plus Fibonacciho extenzie.<br><br>Viac indikátorov neznamená automaticky vyššiu presnosť – väčšina meria to isté (cenu). Preto ich radar používa ako konfluenciu a pravdu ukáže backtest. Nie je to investičné poradenstvo.</p>`;
  const num = (id, f) => { $(id).onchange = e => { f(e.target.value); save(); BT.clear(); rescanAll(); }; };
  num('#sAcc', v => S.account = Math.max(0, +v || 0)); num('#sRisk', v => S.risk = Math.min(10, Math.max(0.1, +v || 1)));
  num('#sCostC', v => S.cost.crypto = Math.max(0, +v || 0)); num('#sCostS', v => { S.cost.stock = S.cost.etf = Math.max(0, +v || 0); });
  $('#sCur').onchange = e => { S.cur = e.target.value || '€'; save(); };
  const seg = (id, f) => { $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; f(b.dataset.v); save(); renderSettings(); }; };
  seg('#sStrict', v => { S.strict = +v; BT.clear(); rescanAll(); });
  seg('#sCount', v => { S.count = +v; CS.delete('crypto|swing'); CS.delete('crypto|intraday'); if (S.market === 'crypto') scan(); });
  seg('#sTheme', v => { S.theme = v; document.documentElement.dataset.theme = v; });
  FILTERS.forEach(([k]) => { $('#f_' + k).onchange = e => { S.filters[k] = e.target.checked; save(); BT.clear(); rescanAll(); }; });
  $('#sAuto').onchange = e => { S.auto = e.target.checked; save(); render('status'); };
  $('#sMotion').onchange = e => { S.motion = e.target.checked; save(); document.documentElement.classList.toggle('still', !S.motion); };
  $('#sNotify').onchange = async e => {
    if (e.target.checked) { if (typeof Notification === 'undefined') { toast('Tento prehliadač upozornenia nepodporuje.'); e.target.checked = false; return; } const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Upozornenia sú v prehliadači zablokované.'); e.target.checked = false; return; } }
    S.notify = e.target.checked; save();
  };
  $('#sKeyT').onclick = async () => { const k = $('#sKey').value.trim(); if (!k) { S.tdKey = ''; save(); toast('Kľúč odstránený.'); return; } const t = await testKey(k); toast(t.msg); if (t.ok !== false) { S.tdKey = k; save(); } };
  $$('[data-rml]').forEach(b => b.onclick = () => { const m = b.dataset.rml; S.lists[m] = S.lists[m].filter(x => x !== b.dataset.s); save(); for (const md of ['swing', 'intraday']) mapOf(`${m}|${md}`).delete(b.dataset.s); renderSettings(); });
  $$('[data-addl]').forEach(f => f.onsubmit = e => { e.preventDefault(); const m = f.dataset.addl, v = $('input', f).value.trim().toUpperCase(); if (!/^[A-Z0-9.\-]{1,15}$/.test(v) || S.lists[m].includes(v)) return; S.lists[m].push(v); save(); renderSettings(); });
  $('#sDemo').onchange = e => setDemo(e.target.checked);
  $('#sWipe').onclick = async () => { if (!confirm('Naozaj vymazať všetky dáta aplikácie?')) return; try { localStorage.clear(); } catch {} await idb.clear(); location.href = location.pathname; };
}
function rescanAll() { scan(); }

/* ───────── štart ───────── */
function tick() {
  const ctx = ctxKey(), st = stOf(ctx), sp = spec(S.market, S.mode), td = isTd();
  const s = statusInfo(), t = $('#stxt'); if (t && !st.scanning) t.textContent = s.txt;
  if (!S.auto || document.hidden || st.scanning) return;
  if (st.err) { if (!st.err.nokey && Date.now() - st.errAt > 45e3) scan(); return; }
  if (!st.last) return;
  const age = Date.now() - st.last;
  if (td ? (usMarket() ? age >= sp.every : age >= 3 * 36e5) : age >= sp.every) scan();
}
window.addEventListener('hashchange', () => { render('view'); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (route().v === 'detail') chart.draw(null); }, 150); });
document.documentElement.dataset.theme = S.theme; document.documentElement.classList.toggle('still', !S.motion);
renderTop(); render('view');
setInterval(tick, 1000);
scan();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
