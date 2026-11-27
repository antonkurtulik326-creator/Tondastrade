/* Trade Radar – aplikácia (UI + dáta). Logika signálov je v engine.js */
(() => {
'use strict';
const E = window.Engine;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ───────── úložisko ───────── */
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const DEF = { account: 1000, cur: '€', risk: 1, cost: 0.12, count: 20, mode: 'swing', strict: 70, notify: false, auto: true, tdKey: '', watch: [], demo: false };
const S = Object.assign({}, DEF, ls.get('tr2.settings', {}));
if (/[?&]demo=1/.test(location.search)) S.demo = true;
const save = () => ls.set('tr2.settings', S);
let seen = new Set(ls.get('tr2.seen', []));
let LOG = ls.get('tr2.log', []);

const MODES = {
  swing:    { label: 'Swing',    sub: '4H trend · 1H vstup', ltf: '1h',  htf: '4h', ltfMs: 3600e3, htfMs: 14400e3, maxBars: 72, histLtf: 3000, histHtf: 1000, hold: '3 dní' },
  intraday: { label: 'Intraday', sub: '1H trend · 15M vstup', ltf: '15m', htf: '1h', ltfMs: 900e3,  htfMs: 3600e3,  maxBars: 64, histLtf: 3000, histHtf: 1000, hold: '16 hodín' }
};
const IV_MS = { '15m': 900e3, '1h': 3600e3, '4h': 14400e3 };
const STATE = { BUY: 'KÚPIŤ', WATCH: 'SLEDOVAŤ', WAIT: 'ČAKAŤ', AVOID: 'NEKUPOVAŤ' };
const ORDER = { BUY: 0, WATCH: 1, WAIT: 2, AVOID: 3 };
const cfg = () => ({ minScore: S.strict, costPct: S.cost });

/* ───────── formátovanie ───────── */
const nf = (x, d) => x.toLocaleString('sk-SK', { minimumFractionDigits: d, maximumFractionDigits: d });
const price = p => nf(p, p >= 100 ? 2 : p >= 1 ? 3 : p >= 0.1 ? 4 : p >= 0.01 ? 5 : 7);
const pct = (x, d = 2) => (x > 0 ? '+' : '') + nf(x, d) + ' %';
const money = x => nf(x, Math.abs(x) >= 100 ? 0 : 2) + ' ' + S.cur;
const qtyFmt = q => nf(q, q >= 100 ? 2 : q >= 1 ? 4 : 6);
const R = x => (x > 0 ? '+' : '') + nf(x, 2) + 'R';
const hhmm = t => new Date(t).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
const dmy = t => new Date(t).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
const ago = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim(); };
const baseOf = s => s.replace(/USDT$/, '');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }

/* ───────── sieť ───────── */
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
let tdChain = Promise.resolve();
const tdQueue = fn => { const p = tdChain.then(fn); tdChain = p.catch(() => {}).then(() => new Promise(r => setTimeout(r, 7800))); return p; };
function tdKlines(sym, iv, size) {
  const ivm = { '15m': '15min', '1h': '1h', '4h': '4h' }[iv];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${ivm}&outputsize=${Math.min(size, 5000)}&order=asc&timezone=UTC&apikey=${encodeURIComponent(S.tdKey)}`;
  return tdQueue(async () => {
    const j = await (await fetch(url)).json();
    if (j.status === 'error' || !j.values) throw new Error(j.message || 'Chyba Twelve Data');
    return j.values.map(v => ({ t: Date.parse(v.datetime.replace(' ', 'T') + 'Z'), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0) }));
  });
}
/* demo (simulované dáta – iba keď to používateľ výslovne zapne) */
const DEMO_SYMS = 'BTC ETH BNB SOL XRP DOGE ADA TRX AVAX LINK DOT LTC BCH NEAR UNI ATOM XLM ETC FIL INJ AAVE ARB OP SUI APT HBAR TON PEPE SHIB ICP'.split(' ').map(x => x + 'USDT');
const demoBase = {};
function demoKlines(sym, iv, total) {
  const b = demoBase[sym] || (demoBase[sym] = E.synth15(sym, 16000, Date.now()));
  const a = iv === '15m' ? b : E.aggregate(b, IV_MS[iv]);
  return Promise.resolve(a.slice(-total));
}
/* cache s deduplikáciou požiadaviek */
const cache = new Map();
function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.p;
  const p = fn(); const e = { at: Date.now(), p }; cache.set(key, e);
  p.catch(() => { if (cache.get(key) === e) cache.delete(key); });
  return p;
}
function klines(rec, iv, total, ttl) {
  const key = `${rec.src}|${rec.sym}|${iv}|${total}`;
  return cached(key, ttl, () => S.demo ? demoKlines(rec.sym, iv, total) : rec.src === 'td' ? tdKlines(rec.sym, iv, total) : bnKlines(rec.sym, iv, total));
}
async function tickers() {
  if (S.demo) return DEMO_SYMS.map(s => { const bars = demoBase[s] || (demoBase[s] = E.synth15(s, 16000, Date.now())); const last = bars[bars.length - 1].c, d = bars[bars.length - 97].c; return { symbol: s, lastPrice: last, priceChangePercent: (last / d - 1) * 100, quoteVolume: Math.pow(10, 9 - DEMO_SYMS.indexOf(s) * 0.12) }; });
  return cached('tick', 240e3, () => bnGet('/api/v3/ticker/24hr'));
}
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|USDE|USD1|BUSD|EUR|EURI|AEUR|GBP|TRY|BRL|PYUSD|XUSD|RLUSD|USDS|BFUSD|UST|WBTC|WBETH)$/;
async function universe() {
  const rows = await tickers();
  const all = rows.filter(r => r.symbol.endsWith('USDT')).map(r => ({ sym: r.symbol, price: +r.lastPrice, chg: +r.priceChangePercent, vol: +r.quoteVolume }))
    .filter(x => !STABLE.test(baseOf(x.sym)) && x.price > 0 && !(x.price > 0.97 && x.price < 1.03 && Math.abs(x.chg) < 0.6));
  all.sort((a, b) => b.vol - a.vol);
  const known = new Map(all.map(x => [x.sym, x]));
  const items = all.slice(0, S.count).map(x => ({ sym: x.sym, src: 'bn', chg: x.chg, tk: x }));
  for (const w of S.watch) if (!items.find(i => i.sym === w.sym)) items.push({ sym: w.sym, src: w.src, chg: known.get(w.sym)?.chg, tk: known.get(w.sym), mine: true });
  return { items, known };
}
const pool = async (arr, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => { while (i < arr.length) { const x = arr[i++]; await fn(x); } })); };

/* ───────── stav skenera ───────── */
const M = new Map();            // sym -> záznam analýzy
let scanning = false, lastScan = 0, scanErr = null, scanErrAt = 0, progress = [0, 0], knownTk = new Map(), firstDone = false;
const BT = new Map();           // kľúč -> { res | pending }

async function analyze(it) {
  const m = MODES[S.mode];
  const rec0 = { sym: it.sym, src: it.src };
  const [lb0, hb0] = await Promise.all([klines(rec0, m.ltf, 400, 45e3), klines(rec0, m.htf, 300, 45e3)]);
  const now = Date.now();
  const live = lb0[lb0.length - 1];
  const lb = lb0.filter(b => b.t + m.ltfMs <= now), hb = hb0.filter(b => b.t + m.htfMs <= now);
  if (lb.length < 120 || hb.length < 70) throw new Error('Málo histórie');
  const L = E.prep(lb), H = E.prep(hb), hmap = E.mapHtf(L, H, m.ltfMs, m.htfMs);
  const px = live.c;
  const lv = E.live(L, H, hmap, cfg(), px);
  if (!lv) throw new Error('Nedá sa vyhodnotiť');
  const back = Math.round(86400e3 / m.ltfMs);
  const chg = it.chg != null && isFinite(it.chg) ? it.chg : (L.n > back ? (px / L.c[L.n - 1 - back] - 1) * 100 : 0);
  return { sym: it.sym, src: it.src, mine: it.mine, price: px, chg, L, H, hmap, lv, state: lv.state, score: lv.score, sig: lv.status === 'active' ? lv.sig : null, hint: lv.hint, spark: L.c.slice(-48), mode: S.mode, at: now };
}

async function scan(force) {
  if (scanning) return;
  scanning = true; scanErr = null; render('status');
  const mode = S.mode;
  try {
    if (force) for (const k of [...cache.keys()]) if (k === 'tick' || /\|(400|300)$/.test(k)) cache.delete(k);
    const { items, known } = await universe();
    knownTk = known; progress = [0, items.length];
    if (!firstDone) render('list');
    let okN = 0, lastErr = null;
    await pool(items, 4, async it => {
      try { const r = await analyze(it); if (mode === S.mode) { M.set(it.sym, r); okN++; } }
      catch (e) { lastErr = e; if (!M.has(it.sym)) M.set(it.sym, { sym: it.sym, src: it.src, error: e.message || 'Chyba', state: 'WAIT', score: 0, mode: S.mode }); }
      progress[0]++; const st = $('#stxt'); if (st) st.textContent = `Načítavam ${progress[0]}/${progress[1]}`; if (mode === S.mode) render('list');
    });
    // vyradiť symboly, ktoré už nie sú v zozname
    const keep = new Set(items.map(i => i.sym)); for (const k of [...M.keys()]) if (!keep.has(k)) M.delete(k);
    if (!okN && lastErr) throw lastErr;
    lastScan = Date.now(); firstDone = true;
    handleAlerts(); queueBacktests();
  } catch (e) { scanErr = e; scanErrAt = Date.now(); }
  finally { scanning = false; render('all'); }
}

/* ───────── backtest ───────── */
const btKey = (sym, src) => `${sym}|${src}|${S.mode}|${S.strict}|${S.cost}`;
let btChain = Promise.resolve();
function ensureBT(rec) {
  const key = btKey(rec.sym, rec.src), c = BT.get(key);
  if (c) return c.pending || Promise.resolve(c.res);
  const m = MODES[S.mode], entry = {};
  entry.pending = btChain = btChain.then(async () => {
    const [lb, hb] = await Promise.all([klines(rec, m.ltf, m.histLtf, 600e3), klines(rec, m.htf, m.histHtf, 600e3)]);
    await new Promise(r => setTimeout(r, 0));
    entry.res = E.runBacktest(lb, hb, m, cfg(), Date.now());
  }).catch(e => { entry.err = e; }).then(() => { entry.pending = null; render('bt'); return entry.res; });
  BT.set(key, entry);
  return entry.pending;
}
function queueBacktests() {
  const list = [...M.values()].filter(r => r.L && (r.state === 'BUY' || r.state === 'WATCH')).sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.score - a.score).slice(0, 12);
  for (const r of list) ensureBT(r);
}
const btOf = rec => { const c = rec && BT.get(btKey(rec.sym, rec.src)); return c ? { res: c.res, pending: !!c.pending, err: c.err } : null; };

/* ───────── upozornenia ───────── */
function handleAlerts() {
  let fresh = 0;
  for (const r of M.values()) {
    if (r.state !== 'BUY' || !r.sig) continue;
    const key = `${r.sym}|${r.mode}|${r.sig.ev.t}`;
    if (seen.has(key)) continue;
    seen.add(key); fresh++;
    const p = r.sig.ev.plan;
    LOG.unshift({ key, at: Date.now(), sym: r.sym, src: r.src, mode: r.mode, price: r.price, score: r.score, trigger: r.sig.ev.trigger, entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, unread: true });
    if (r.sig.age <= 1) notify(r);
  }
  if (fresh) { LOG = LOG.slice(0, 100); ls.set('tr2.log', LOG); ls.set('tr2.seen', [...seen].slice(-400)); toast(`Nový signál na nákup: ${fresh}×`); }
}
function notify(r) {
  if (!S.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const p = r.sig.ev.plan;
  const title = `KÚPIŤ: ${baseOf(r.sym)} – skóre ${r.score}`;
  const opts = { body: `Vstup ${price(p.entry)} · Stop ${price(p.stop)} · TP1 ${price(p.tp1)}`, icon: 'icon-192.png', tag: r.sym };
  navigator.serviceWorker?.getRegistration().then(reg => reg ? reg.showNotification(title, opts) : new Notification(title, opts)).catch(() => {});
}

/* ───────── drobné UI prvky ───────── */
const ring = (score, state, size = 54) => {
  const r = (size - 7) / 2, c = 2 * Math.PI * r, h = size / 2;
  return `<svg class="ring s-${state} ${size > 60 ? 'big' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="trk" cx="${h}" cy="${h}" r="${r}"/><circle class="val" cx="${h}" cy="${h}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(100, score)) / 100)}" transform="rotate(-90 ${h} ${h})"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${Math.round(score)}</text></svg>`;
};
const spark = (arr, state) => {
  if (!arr || arr.length < 2) return '';
  const mn = Math.min(...arr), mx = Math.max(...arr), w = 92, h = 26;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 2 - (v - mn) / (mx - mn || 1) * (h - 4)).toFixed(1)}`).join(' ');
  const col = arr[arr.length - 1] >= arr[0] ? 'var(--buy)' : 'var(--avoid)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" style="stroke:${col}"/></svg>`;
};
const btTag = rec => {
  const b = btOf(rec); if (!b) return '';
  if (b.pending) return '<span class="tag">backtest…</span>';
  if (!b.res) return '';
  const v = b.res.verdict, st = b.res.st;
  if (v.k === 'low') return `<span class="tag">málo dát (${st.n})</span>`;
  return `<span class="tag ${v.k === 'good' ? 'good' : v.k === 'bad' ? 'bad' : ''}">${v.k === 'good' ? '✓' : v.k === 'bad' ? '✕' : '~'} ${R(st.avgR)} · ${st.n} obch.</span>`;
};
function card(r) {
  if (r.error) return `<a class="card s-WAIT" href="#/s/${r.sym}"><div class="crow"><div class="cmain"><div class="cname"><b>${esc(baseOf(r.sym))}</b><span>${esc(r.src === 'td' ? 'Twelve Data' : 'USDT')}</span></div><div class="hint">${esc(r.error)}</div></div></div></a>`;
  return `<a class="card s-${r.state}" href="#/s/${r.sym}">
    <div class="crow">${ring(r.score, r.state)}
      <div class="cmain"><div class="cname"><b>${esc(baseOf(r.sym))}</b><span>${esc(r.src === 'td' ? r.sym : 'USDT')}</span></div>
        <div style="margin-top:5px"><span class="badge ${r.state}">${STATE[r.state]}</span>${btTag(r)}</div></div>
      <div class="cprice"><b>${price(r.price)}</b><span class="chg ${r.chg >= 0 ? 'up' : 'dn'}">${pct(r.chg)}</span></div></div>
    <div class="cfoot"><div class="hint" style="margin:0;flex:1">${esc(r.hint)}</div>${spark(r.spark, r.state)}</div></a>`;
}

/* ───────── hlavička a zobrazenia ───────── */
let filter = 'all', cd = 0;
function renderTop() {
  const m = MODES[S.mode];
  const dot = scanning ? 'busy' : scanErr ? 'err' : lastScan ? 'live' : '';
  const txt = scanning ? (progress[1] ? `Načítavam ${progress[0]}/${progress[1]}` : 'Pripájam sa…') : scanErr ? 'Bez spojenia' : lastScan ? `${hhmm(lastScan)}${S.auto ? ` · ${Math.max(0, cd)} s` : ''}` : '';
  $('#top').innerHTML = `<div class="row"><div class="brand"><img src="icon-192.png" alt=""><b>Trade <i>Radar</i></b></div>
    <div class="status"><span class="dot ${dot}"></span><span id="stxt">${txt}</span>
    <button class="iconbtn ${scanning ? 'spin' : ''}" id="refresh" aria-label="Obnoviť"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg></button></div></div>
    ${S.demo ? '<div class="demo-ribbon"><b>DEMO režim</b> – simulované dáta, nie skutočný trh. Signály nemajú žiadnu hodnotu pre reálne obchodovanie.</div>' : ''}`;
  $('#refresh').onclick = () => scan(true);
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('s/')) return { v: 'detail', sym: decodeURIComponent(h.slice(2)) };
  if (h === 'log') return { v: 'log' };
  if (h === 'settings') return { v: 'settings' };
  return { v: 'scan' };
}
function render(part) {
  const r = route();
  if (part === 'status' || part === 'all') renderTop();
  const tab = r.v === 'detail' ? 'scan' : r.v;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const un = LOG.filter(x => x.unread).length; const n = $('#logN'); n.hidden = !un; n.textContent = un;
  if (part === 'status') return;
  const act = document.activeElement;
  if (r.v === 'scan' && (part === 'list' || part === 'bt' || part === 'all' || part === 'view')) renderScan(part === 'view');
  else if (r.v === 'detail' && part !== 'list' && !(act && act.closest && act.closest('#view') && /INPUT/.test(act.tagName))) renderDetail(r.sym);
  else if (r.v === 'log' && (part === 'view' || part === 'all')) renderLog();
  else if (r.v === 'settings' && part === 'view') renderSettings();
}

/* ───────── skener ───────── */
function renderScan(full) {
  const v = $('#view');
  const recs = [...M.values()].filter(r => r.mode === S.mode);
  const cnt = { BUY: 0, WATCH: 0, WAIT: 0, AVOID: 0 }; recs.forEach(r => !r.error && cnt[r.state]++);
  const shown = recs.filter(r => filter === 'all' || (filter === 'BUY' && r.state === 'BUY') || (filter === 'WATCH' && (r.state === 'BUY' || r.state === 'WATCH')))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.score - a.score);
  let body;
  if (scanErr && !recs.some(r => !r.error)) {
    body = `<div class="banner"><b>Nepodarilo sa načítať trhové dáta</b>${esc(scanErr.message || String(scanErr))}. Skontroluj internet alebo VPN (Binance nie je dostupný vo všetkých krajinách).
      <div class="btns"><button class="btn gold" id="retry">Skúsiť znova</button><button class="btn" id="godemo">Spustiť DEMO (simulované dáta)</button></div></div>`;
  } else if (!recs.length) {
    body = `<div class="list">${'<div class="sk"></div>'.repeat(6)}</div>`;
  } else {
    body = `<div class="list">${shown.map(card).join('') || '<div class="empty"><b>Žiadny signál</b>Teraz nie je čo kupovať. Správne je čakať.</div>'}</div>`;
  }
  if (!full && $('#scanbody')) { $('#scanbody').innerHTML = body; $('#sumbar').innerHTML = sumHtml(cnt); bindScan(); return; }
  v.innerHTML = `<h1 class="title">Kedy nakúpiť</h1>
    <p class="lead">Skener hľadá nákupné príležitosti v rastúcom trende – pullback na EMA21 alebo breakout s objemom. Každý signál má stop, ciele a historické overenie.</p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="seg" id="modeSeg">${Object.entries(MODES).map(([k, m]) => `<button data-m="${k}" class="${S.mode === k ? 'on' : ''}">${m.label}<small>${m.sub}</small></button>`).join('')}</div></div>
    <div class="summary" id="sumbar">${sumHtml(cnt)}</div>
    <div class="chips" id="chips">${[['all', 'Všetko'], ['BUY', 'Kúpiť'], ['WATCH', 'Sledovať']].map(([k, t]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div id="scanbody">${body}</div>
    <form class="addrow" id="addf"><input type="search" id="addsym" placeholder="Pridať symbol (napr. LINK alebo AAPL)" autocapitalize="characters" autocomplete="off"><button class="btn gold" type="submit">Pridať</button></form>
    <p class="foot">Signály sú technická analýza, nie investičné poradenstvo. Obchoduješ na vlastné riziko – aplikácia nezadáva žiadne príkazy.</p>`;
  $('#modeSeg').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.m === S.mode) return; S.mode = b.dataset.m; save(); M.clear(); firstDone = false; render('view'); scan(); };
  $('#chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filter = b.dataset.f; render('view'); };
  $('#addf').onsubmit = addSymbol;
  bindScan();
}
const sumHtml = c => `<div class="pill buy"><b>${c.BUY}</b><span>kúpiť</span></div><div class="pill watch"><b>${c.WATCH}</b><span>sledovať</span></div><div class="pill"><b>${c.WAIT + c.AVOID}</b><span>čaká / nie</span></div>`;
function bindScan() { const a = $('#retry'); if (a) a.onclick = () => scan(true); const b = $('#godemo'); if (b) b.onclick = () => { S.demo = true; save(); M.clear(); cache.clear(); firstDone = false; scanErr = null; render('view'); scan(); }; }
async function addSymbol(e) {
  e.preventDefault();
  const raw = $('#addsym').value.trim().toUpperCase().replace(/\s+/g, ''); if (!raw) return;
  const bn = raw.endsWith('USDT') ? raw : raw + 'USDT';
  let w;
  if (knownTk.has(bn) || S.demo) w = { sym: bn, src: 'bn' };
  else if (S.tdKey) w = { sym: raw, src: 'td' };
  else { toast('Akcie a ETF vyžadujú kľúč Twelve Data – vlož ho v Nastaveniach.'); return; }
  if (S.watch.find(x => x.sym === w.sym) || (M.has(w.sym) && !M.get(w.sym).error)) { toast('Symbol už v zozname je.'); return; }
  S.watch.push(w); save(); $('#addsym').value = ''; toast(`Pridané: ${raw}`); scan();
}

/* ───────── detail ───────── */
function renderDetail(sym) {
  const r = M.get(sym), v = $('#view');
  const back = '<a class="back" href="#/">← Späť na skener</a>';
  if (!r || r.error) { v.innerHTML = back + `<div class="empty"><b>${esc(baseOf(sym))}</b>${r && r.error ? esc(r.error) : (scanning || !firstDone ? 'Načítavam…' : 'Symbol nie je v skeneri.')}</div>`; return; }
  const m = MODES[r.mode], ev = r.lv.ev, p = ev.plan, bt = btOf(r), res = bt && bt.res;
  const sig = r.sig, isBuy = r.state === 'BUY' && sig;
  const sp = isBuy ? E.sizing(S.account, S.risk, Math.max(r.price, p.entry), p.stop, S.cost) : null;
  const age = sig ? (sig.age === 0 ? 'práve vznikol' : `vznikol pred ${sig.age} sviečkou`) : '';
  const warnBt = isBuy && res && res.verdict.k === 'bad' ? '<div class="warn">⚠ Na tomto symbole stratégia v histórii nefungovala. Ber to ako slabší signál alebo ho preskoč.</div>' : isBuy && res && res.verdict.k === 'low' ? '<div class="warn">ℹ História tohto symbolu má málo obchodov – overenie je len orientačné.</div>' : '';
  const stopPct = (p.entry - p.stop) / p.entry * 100;
  const own = S.watch.find(x => x.sym === sym);
  v.innerHTML = `${back}
  <div class="dhead"><div><h1>${esc(baseOf(sym))}</h1><span class="small">${esc(sym)} · ${m.label} (${m.sub})</span></div>
    <div class="p"><b>${price(r.price)}</b><span class="chg ${r.chg >= 0 ? 'up' : 'dn'}">${pct(r.chg)} / 24 h</span></div></div>
  <div class="dgrid"><div style="display:grid;gap:12px">
    <div class="card pad s-${r.state}"><div class="hero">${ring(r.score, r.state, 78)}
      <div><span class="badge ${r.state}">${STATE[r.state]}</span>${btTag(r)}<p>${esc(r.hint)}${sig ? ` <span class="small">(${age})</span>` : ''}</p></div></div>${warnBt}</div>
    ${isBuy ? planCard(r, p, stopPct) : levelsCard(r, ev)}
    ${isBuy ? `<div class="card pad" id="calc">${calcHtml(sp, p, r)}</div>` : ''}
    <div class="card pad"><h2 class="sec" style="margin-top:0">Prečo takéto skóre</h2><ul class="checks">${ev.checks.map(c => `<li class="${c.ok === true ? 'y' : c.ok === false ? 'n' : 'u'}"><i>${c.ok === true ? '✓' : c.ok === false ? '✕' : '–'}</i><div>${esc(c.label)}<span>${esc(c.detail)}</span></div></li>`).join('')}</ul>
      <div class="sep"></div><p class="small">Skóre 0–100: trend vyššieho TF (30) + štruktúra nižšieho TF a momentum (20) + kvalita vstupu (30) + objem (10) + priestor do rezistencie (10). Skóre meria <b>zhodu podmienok</b>, nie pravdepodobnosť zisku – tú ukazuje backtest vedľa.</p></div>
  </div><div style="display:grid;gap:12px">
    <div class="card pad"><h2 class="sec" style="margin-top:0">Graf · ${m.ltf === '1h' ? '1 hodina' : '15 minút'}</h2><div class="readout" id="readout"></div><canvas class="chart" id="chart"></canvas>
      <div class="legend"><span><i style="background:var(--gold)"></i>EMA21</span><span><i style="background:#7e8aa6"></i>EMA50</span>${isBuy ? '<span><i style="background:var(--buy)"></i>vstup / ciele</span><span><i style="background:var(--avoid)"></i>stop</span>' : ''}<span>▲ historické signály</span></div></div>
    <div class="card pad" id="btbox">${btHtml(r, bt)}</div>
    ${own ? `<button class="btn danger" id="rm">Odstrániť ${esc(baseOf(sym))} zo sledovaných</button>` : ''}
  </div></div>
  <p class="foot">Nie je to investičné poradenstvo. Minulé výsledky nezaručujú budúce. Obchody zadávaš a riadiš sám u svojho brokera/burzy.</p>`;
  const rm = $('#rm'); if (rm) rm.onclick = () => { S.watch = S.watch.filter(x => x.sym !== sym); save(); M.delete(sym); location.hash = '#/'; };
  bindCalc(r, p);
  drawChartFor(r, res, isBuy ? p : null);
  drawEquity(res);
}
function planCard(r, p, stopPct) {
  const m = MODES[r.mode], zoneHi = p.entry + 0.3 * p.risk, inZone = r.price <= zoneHi;
  const pc = x => pct((x / p.entry - 1) * 100, 1);
  return `<div class="card pad s-BUY"><h2 class="sec" style="margin-top:0">Obchodný plán</h2><div class="kv">
    <span class="k">Vstup</span><span class="s">${inZone ? 'cena je v zóne' : 'cena je nad zónou – opatrne'}</span><span class="v big">${price(p.entry)} – ${price(zoneHi)}</span>
    <span class="k">Stop loss</span><span class="s">−${nf(stopPct, 1)} %</span><span class="v dn big">${price(p.stop)}</span>
    <span class="k">TP1 (1,5R)</span><span class="s">${pc(p.tp1)} · predaj ½, stop na vstup</span><span class="v up">${price(p.tp1)}</span>
    <span class="k">TP2 (3R)</span><span class="s">${pc(p.tp2)} · zvyšok</span><span class="v up">${price(p.tp2)}</span>
    <span class="k">Max. držanie</span><span class="s">ak sa nič nestane</span><span class="v">~${m.hold}</span></div>
    <div class="sep"></div><p class="small">Stop je pod posledným swing low (1–3× ATR). Ak cena zavrie pod stop, plán padá – nepridávaj, neprepisuj stop nižšie.</p></div>`;
}
function levelsCard(r, ev) {
  const L = r.L, i = L.n - 1;
  return `<div class="card pad"><h2 class="sec" style="margin-top:0">Kľúčové úrovne</h2><div class="kv">
    <span class="k">EMA21</span><span class="s">zóna nákupu pri pullbacku</span><span class="v">${price(L.ema21[i])}</span>
    <span class="k">EMA50</span><span class="s">pod ňou trend slabne</span><span class="v">${price(L.ema50[i])}</span>
    <span class="k">ATR(14)</span><span class="s">typický pohyb sviečky</span><span class="v">${price(ev.plan.atr)}</span>
    <span class="k">RSI(14)</span><span class="s">${ev.rsi >= 70 ? 'prekúpené' : ev.rsi <= 30 ? 'prepredané' : 'neutrálne'}</span><span class="v">${nf(ev.rsi, 0)}</span></div>
    <div class="sep"></div><p class="small">Obchodný plán (vstup, stop, ciele) sa zobrazí, až keď vznikne aktívny signál „KÚPIŤ“.</p></div>`;
}
function calcHtml(sp, p, r) {
  if (!sp) return '';
  const cap = sp.notional > S.account, qty = cap ? S.account / Math.max(r.price, p.entry) : sp.qty, notional = cap ? S.account : sp.notional;
  const realRisk = qty * (Math.max(r.price, p.entry) - p.stop);
  return `<h2 class="sec" style="margin-top:0">Koľko kúpiť</h2>
  <div class="calc"><div><label>Účet (${esc(S.cur)})</label><input type="number" inputmode="decimal" id="cAcc" value="${S.account}" min="0"></div>
  <div><label>Riziko na obchod (%)</label><input type="number" inputmode="decimal" id="cRisk" value="${S.risk}" min="0.1" max="10" step="0.1"></div>
  <div><label>Mena</label><input type="text" id="cCur" value="${esc(S.cur)}" maxlength="4"></div></div>
  <div class="calcout">Riskuješ <b>${money(realRisk)}</b>. Kúp za <b>${money(notional)}</b> (${nf(notional / S.account * 100, 0)} % účtu) = <b>${qtyFmt(qty)} ${esc(baseOf(r.sym))}</b>. Poplatky tam a späť ≈ ${money(notional * S.cost / 100 * 2)}.
  ${cap ? `<br><span class="small" style="color:var(--gold2)">Pri tomto stope by pozícia presiahla účet – je orezaná na celý účet, takže reálne riskuješ menej než ${nf(S.risk, 1)} %. Pákový efekt nepoužívaj.</span>` : ''}</div>`;
}
function bindCalc(r, p) {
  const upd = () => { S.account = Math.max(0, +$('#cAcc').value || 0); S.risk = Math.min(10, Math.max(0.1, +$('#cRisk').value || 1)); S.cur = $('#cCur').value || '€'; save();
    const sp = E.sizing(S.account, S.risk, Math.max(r.price, p.entry), p.stop, S.cost); const out = $('.calcout'); if (out && sp) { const tmp = document.createElement('div'); tmp.innerHTML = calcHtml(sp, p, r); out.innerHTML = $('.calcout', tmp).innerHTML; } };
  ['#cAcc', '#cRisk', '#cCur'].forEach(s => { const e = $(s); if (e) e.oninput = upd; });
}
function btHtml(r, bt) {
  const m = MODES[r.mode];
  const head = '<h2 class="sec" style="margin-top:0">Overenie na histórii</h2>';
  if (!bt || bt.pending) return head + `<div class="sk" style="height:120px"></div><p class="small" style="margin-top:10px">Sťahujem ~${m.histLtf} sviečok a simulujem rovnaké pravidlá spätne…</p>`;
  if (bt.err || !bt.res) return head + `<p class="small">Backtest sa nepodarilo spustiť (${esc(bt.err ? bt.err.message : 'málo dát')}).</p>`;
  const x = bt.res, st = x.st, v = x.verdict, o = x.oos;
  const days = Math.round((x.to - x.from) / 86400e3);
  if (!st.n) return head + `<p class="small">Za ${days} dní stratégia na tomto symbole nevygenerovala žiadny obchod.</p>`;
  const rows = x.trades.filter(t => !t.open).slice(-8).reverse();
  const rl = { TP2: 'TP2', BE: 'break-even', SL: 'stop', TIME: 'čas' };
  return head + `<span class="tag ${v.k === 'good' ? 'good' : v.k === 'bad' ? 'bad' : ''}" style="margin:0">${esc(v.text)}</span>
  <p class="small" style="margin:8px 0 0">Rovnaké pravidlá spätne na ${days} dňoch (${dmy(x.from)} – ${dmy(x.to)}). Cena samotná za obdobie: ${pct(x.bh * 100, 0)}.</p>
  <div class="kpis"><div class="kpi"><span>Obchody</span><b>${st.n}</b></div><div class="kpi"><span>Úspešnosť</span><b>${nf(st.winRate * 100, 0)} %</b></div><div class="kpi"><span>Priemer / obchod</span><b class="${st.avgR >= 0 ? 'up' : 'dn'}">${R(st.avgR)}</b></div>
  <div class="kpi"><span>Profit factor</span><b>${isFinite(st.pf) ? nf(st.pf, 2) : '∞'}</b></div><div class="kpi"><span>Max. pokles</span><b>−${nf(st.maxDD, 1)}R</b></div><div class="kpi"><span>Spolu</span><b class="${st.totalR >= 0 ? 'up' : 'dn'}">${R(st.totalR)}</b></div></div>
  <canvas id="eq" style="width:100%;height:110px;display:block"></canvas>
  <p class="small" style="margin-top:8px">Posledných 30 % obdobia (nezávislé od ladenia): ${o.n ? `${o.n} obchodov, priemer ${R(o.avgR)}` : 'bez obchodov'}.</p>
  <table class="tr"><tr><th>Dátum</th><th>Koniec</th><th>Výsledok</th></tr>${rows.map(t => `<tr><td>${dmy(t.t)} ${hhmm(t.t)}</td><td>${rl[t.reason] || t.reason} · ${t.bars} sv.</td><td class="${t.r >= 0 ? 'up' : 'dn'}">${R(t.r)}</td></tr>`).join('')}</table>
  <p class="small" style="margin-top:10px">1R = vzdialenosť vstup–stop. Vstup na otvorení ďalšej sviečky, poplatky+slippage ${nf(S.cost, 2)} % na stranu, pri stope aj cieli v jednej sviečke vyhráva stop, TP1 = ½ pozície + stop na vstup, časový stop ${m.maxBars} sviečok. Funding/swap nie je započítaný.</p>`;
}

/* ───────── grafy ───────── */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function drawChartFor(r, res, plan) {
  const cv = $('#chart'); if (!cv) return;
  const L = r.L, nVis = Math.min(110, L.n), s0 = L.n - nVis;
  const idx = new Map(); for (let i = s0; i < L.n; i++) idx.set(L.t[i], i);
  const marks = res ? res.trades.map(t => idx.get(res.L.t[t.si])).filter(i => i !== undefined) : [];
  const draw = hover => {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const pl = 4, pr = 64, pt = 8, pb = 20, pw = w - pl - pr, ph = h - pt - pb, bw = pw / nVis;
    let mn = Infinity, mx = -Infinity;
    for (let i = s0; i < L.n; i++) { mn = Math.min(mn, L.l[i]); mx = Math.max(mx, L.h[i]); }
    if (plan) { mn = Math.min(mn, plan.stop); mx = Math.max(mx, plan.tp1, plan.tp2 < mx * 1.06 ? plan.tp2 : 0); }
    const pad = (mx - mn) * 0.05; mn -= pad; mx += pad;
    const Y = v => pt + (1 - (v - mn) / (mx - mn)) * ph, X = i => pl + (i - s0 + 0.5) * bw;
    const buy = css('--buy'), red = css('--avoid'), mute = css('--dim'), line = css('--line');
    g.font = '10.5px ' + css('--sans'); g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, y = Y(v); g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + pw, y); g.stroke(); g.fillStyle = mute; g.textAlign = 'left'; g.fillText(price(v), pl + pw + 6, y); }
    for (let k = 0; k < 3; k++) { const i = s0 + Math.round((nVis - 1) * k / 2); g.fillStyle = mute; g.textAlign = k === 2 ? 'right' : k === 0 ? 'left' : 'center'; g.fillText(`${dmy(L.t[i])} ${hhmm(L.t[i])}`, X(i), h - 8); }
    for (let i = s0; i < L.n; i++) {
      const up = L.c[i] >= L.o[i], col = up ? buy : red, x = X(i);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(L.h[i])); g.lineTo(x, Y(L.l[i])); g.stroke();
      const y1 = Y(Math.max(L.o[i], L.c[i])), y2 = Y(Math.min(L.o[i], L.c[i])); g.fillRect(x - bw * 0.36, y1, bw * 0.72, Math.max(1, y2 - y1));
    }
    const ema = (arr, col) => { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); let st = false; for (let i = s0; i < L.n; i++) { if (!isFinite(arr[i])) continue; const x = X(i), y = Y(arr[i]); st ? g.lineTo(x, y) : (g.moveTo(x, y), st = true); } g.stroke(); };
    ema(L.ema50, '#7e8aa6'); ema(L.ema21, css('--gold'));
    if (plan) {
      [[plan.tp2, buy, 'TP2'], [plan.tp1, buy, 'TP1'], [plan.entry, css('--text'), 'vstup'], [plan.stop, red, 'stop']].forEach(([v, col, lb]) => {
        if (v < mn || v > mx) return; const y = Y(v); g.strokeStyle = col; g.globalAlpha = 0.8; g.setLineDash([5, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + pw, y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        g.fillStyle = col; g.textAlign = 'right'; g.fillText(lb, pl + pw - 4, y - 7);
      });
    }
    g.fillStyle = css('--gold2');
    for (const i of marks) { const x = X(i), y = Y(L.l[i]) + 9; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x - 4.5, y + 3); g.lineTo(x + 4.5, y + 3); g.closePath(); g.fill(); }
    if (hover != null) {
      const x = X(hover); g.strokeStyle = css('--mute'); g.globalAlpha = .5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + ph); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    cv._geo = { pl, bw, s0, n: nVis };
  };
  const ro = $('#readout'), show = i => { ro.innerHTML = i == null ? `Posledná zatvorená sviečka: ${dmy(L.t[L.n - 1])} ${hhmm(L.t[L.n - 1])}` : `${dmy(L.t[i])} ${hhmm(L.t[i])} · O ${price(L.o[i])} H ${price(L.h[i])} L ${price(L.l[i])} C <b>${price(L.c[i])}</b>`; };
  const at = e => { const g = cv._geo, x = (e.clientX - cv.getBoundingClientRect().left - g.pl) / g.bw; return Math.max(g.s0, Math.min(g.s0 + g.n - 1, g.s0 + Math.floor(x))); };
  cv.onpointermove = e => { const i = at(e); draw(i); show(i); };
  cv.onpointerleave = () => { draw(null); show(null); };
  draw(null); show(null);
}
function drawEquity(res) {
  const cv = $('#eq'); if (!cv || !res || !res.st.curve) return;
  const c = res.st.curve, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const mn = Math.min(0, ...c), mx = Math.max(0.001, ...c), Y = v => 6 + (1 - (v - mn) / (mx - mn)) * (h - 12), X = i => i / (c.length - 1) * (w - 4) + 2;
  g.strokeStyle = css('--line2'); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke(); g.setLineDash([]);
  const col = c[c.length - 1] >= 0 ? css('--buy') : css('--avoid');
  g.beginPath(); c.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
  g.lineTo(X(c.length - 1), Y(0)); g.lineTo(X(0), Y(0)); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col + '40'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fill();
}

/* ───────── signály (log) ───────── */
function renderLog() {
  const v = $('#view');
  v.innerHTML = `<h1 class="title">Signály</h1><p class="lead">História nákupných signálov, ktoré skener zachytil, kým bola aplikácia otvorená.</p>` +
    (LOG.length ? `<div class="list">${LOG.map(x => `<a class="card logi" href="#/s/${x.sym}"><div class="cmain"><div class="cname"><b>${esc(baseOf(x.sym))}</b><span>${MODES[x.mode].label} · ${x.trigger === 'pullback' ? 'pullback' : 'breakout'}</span>${x.unread ? '<span class="tag good">nové</span>' : ''}</div>
      <div class="t">${dmy(x.at)} ${hhmm(x.at)} · skóre ${x.score}</div></div><div class="cprice"><b>${price(x.entry)}</b><span class="small">SL ${price(x.stop)} · TP1 ${price(x.tp1)}</span></div></a>`).join('')}</div><div class="btns"><button class="btn sm" id="clrlog">Vymazať históriu</button></div>`
      : '<div class="empty"><b>Zatiaľ nič</b>Keď skener nájde nákupný signál, zapíše sa sem.</div>') +
    `<p class="foot">Aplikácia kontroluje trh iba kým je otvorená (alebo na pozadí, ak ju prehliadač neuspí). Pre upozornenia aj pri zatvorenej aplikácii je potrebný server – tu žiadny nie je.</p>`;
  const c = $('#clrlog'); if (c) c.onclick = () => { LOG = []; ls.set('tr2.log', LOG); render('all'); renderLog(); };
  if (LOG.some(x => x.unread)) { LOG.forEach(x => x.unread = false); ls.set('tr2.log', LOG); setTimeout(() => { const n = $('#logN'); n.hidden = true; }, 0); }
}

/* ───────── nastavenia ───────── */
function renderSettings() {
  const sw = (id, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></label>`;
  $('#view').innerHTML = `<h1 class="title">Nastavenia</h1><p class="lead">Parametre signálov a riadenia rizika.</p>
  <div class="card pad set">
    <div class="srow"><div><div class="t">Veľkosť účtu</div><div class="d">Na výpočet veľkosti pozície.</div></div><input type="number" inputmode="decimal" id="sAcc" value="${S.account}"></div>
    <div class="srow"><div><div class="t">Mena účtu</div></div><input type="text" id="sCur" value="${esc(S.cur)}" maxlength="4"></div>
    <div class="srow"><div><div class="t">Riziko na obchod (%)</div><div class="d">Koľko % účtu stratíš, ak padne stop. Bežne 0,5–2 %.</div></div><input type="number" inputmode="decimal" step="0.1" id="sRisk" value="${S.risk}"></div>
    <div class="srow"><div><div class="t">Náklady na stranu (%)</div><div class="d">Poplatok + slippage. Binance spot ≈ 0,1 % + trochu. Používa sa v backteste aj kalkulačke.</div></div><input type="number" inputmode="decimal" step="0.01" id="sCost" value="${S.cost}"></div>
  </div>
  <h2 class="sec">Signály</h2><div class="card pad set">
    <div class="srow col"><div><div class="t">Prísnosť</div><div class="d">Minimálne skóre pre „KÚPIŤ“. Prísnejšie = menej, ale kvalitnejších signálov.</div></div>
      <div class="seg" id="sStrict" style="align-self:flex-start;margin-top:8px">${[[60, 'Aktívna'], [70, 'Vyvážená'], [80, 'Prísna']].map(([v, t]) => `<button data-v="${v}" class="${S.strict === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="srow col"><div><div class="t">Počet kryptomien v skeneri</div><div class="d">Najobchodovanejšie USDT páry na Binance.</div></div>
      <div class="seg" id="sCount" style="align-self:flex-start;margin-top:8px">${[10, 20, 30].map(v => `<button data-v="${v}" class="${S.count === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <div class="srow"><div><div class="t">Automatická aktualizácia</div><div class="d">Každých 90 s, kým je aplikácia otvorená.</div></div>${sw('sAuto', S.auto)}</div>
    <div class="srow"><div><div class="t">Upozornenia o signáloch</div><div class="d">Systémové upozornenie pri novom signáli „KÚPIŤ“ (len kým aplikácia beží).</div></div>${sw('sNotify', S.notify)}</div>
  </div>
  <h2 class="sec">Akcie a ETF</h2><div class="card pad set">
    <div class="srow col"><div><div class="t">Kľúč Twelve Data</div><div class="d">Voliteľné. Bez kľúča skener pokrýva krypto z Binance. Zadarmo na twelvedata.com (8 požiadaviek/min – akcie sa načítavajú pomaly). Kľúč zostáva len v tomto prehliadači.</div></div><input type="password" id="sKey" value="${esc(S.tdKey)}" placeholder="API kľúč" style="width:100%;text-align:left;margin-top:8px"></div>
    <div class="srow col"><div><div class="t">Moje symboly</div><div class="d">Pridáš ich vo Skeneri. Krypto stačí zadať ako LINK, akcie ako AAPL.</div></div><div class="wl">${S.watch.length ? S.watch.map(w => `<span>${esc(w.sym)}<button data-rm="${esc(w.sym)}" aria-label="Odstrániť">×</button></span>`).join('') : '<span class="small" style="border:0;padding:0">žiadne</span>'}</div></div>
  </div>
  <h2 class="sec">Ostatné</h2><div class="card pad set">
    <div class="srow"><div><div class="t">DEMO režim</div><div class="d">Simulované dáta na vyskúšanie rozhrania. Nie je to skutočný trh.</div></div>${sw('sDemo', S.demo)}</div>
    <div class="srow"><div><div class="t">Vymazať dáta aplikácie</div><div class="d">Nastavenia, históriu signálov a cache.</div></div><button class="btn danger sm" id="sWipe">Vymazať</button></div>
  </div>
  <p class="foot"><b>Ako to funguje.</b> Vyšší timeframe (4H pri Swing, 1H pri Intraday) musí byť v rastúcom trende. Na nižšom timeframe hľadáme nákup do rastu: pullback k EMA21 s odrazom, alebo breakout nad 20-sviečkové maximum s objemom. Každý signál dostane skóre, stop podľa ATR a ciele 1,5R a 3R. Rovnaké pravidlá sa spätne otestujú na histórii symbolu.<br><br>Žiadna stratégia nevyhráva vždy. Aplikácia je pomôcka na disciplínu, nie veštba. Nie je to investičné poradenstvo.</p>`;
  const numSet = (id, key, f) => { $(id).onchange = e => { S[key] = f(e.target.value); save(); invalidate(); }; };
  numSet('#sAcc', 'account', v => Math.max(0, +v || 0)); numSet('#sRisk', 'risk', v => Math.min(10, Math.max(0.1, +v || 1))); numSet('#sCost', 'cost', v => Math.max(0, +v || 0));
  $('#sCur').onchange = e => { S.cur = e.target.value || '€'; save(); };
  $('#sStrict').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.strict = +b.dataset.v; save(); invalidate(true); renderSettings(); };
  $('#sCount').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.count = +b.dataset.v; save(); invalidate(true); renderSettings(); };
  $('#sAuto').onchange = e => { S.auto = e.target.checked; save(); render('status'); };
  $('#sNotify').onchange = async e => {
    if (e.target.checked) { if (typeof Notification === 'undefined') { toast('Tento prehliadač upozornenia nepodporuje.'); e.target.checked = false; return; } const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Upozornenia sú v prehliadači zablokované.'); e.target.checked = false; return; } }
    S.notify = e.target.checked; save();
  };
  $('#sKey').onchange = e => { S.tdKey = e.target.value.trim(); save(); toast(S.tdKey ? 'Kľúč uložený.' : 'Kľúč odstránený.'); };
  $('#sDemo').onchange = e => { S.demo = e.target.checked; save(); M.clear(); cache.clear(); BT.clear(); firstDone = false; scanErr = null; render('all'); scan(); };
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.watch = S.watch.filter(w => w.sym !== b.dataset.rm); save(); M.delete(b.dataset.rm); renderSettings(); });
  $('#sWipe').onclick = () => { if (!confirm('Naozaj vymazať všetky dáta aplikácie?')) return; try { localStorage.clear(); } catch {} location.href = location.pathname; };
}
function invalidate(rescan) { BT.clear(); if (rescan) { M.clear(); firstDone = false; } scan(); }

/* ───────── štart ───────── */
function tick() {
  cd = lastScan ? Math.round((lastScan + 90e3 - Date.now()) / 1000) : 0;
  const t = $('#stxt'); if (t && !scanning && lastScan && !scanErr) t.textContent = `${hhmm(lastScan)}${S.auto ? ` · ${Math.max(0, cd)} s` : ''}`;
  if (S.auto && !document.hidden && !scanning && lastScan && cd <= 0) scan();
  else if (S.auto && !document.hidden && !scanning && scanErr && Date.now() - scanErrAt > 30e3) scan();
}
window.addEventListener('hashchange', () => { render('view'); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && lastScan && Date.now() - lastScan > 60e3) scan(); });
window.addEventListener('resize', () => { if (route().v === 'detail') render('all'); });
renderTop(); render('view');
setInterval(tick, 1000);
scan();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
