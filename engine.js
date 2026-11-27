/* Trade Radar – engine: indikátory, hodnotenie signálu, backtest. Čistá logika bez DOM. */
(function (root) {
'use strict';
const E = {};
const isNum = Number.isFinite;

/* ───────── indikátory ───────── */
E.ema = (v, p) => {
  const n = v.length, o = new Array(n).fill(NaN), k = 2 / (p + 1);
  let st = 0; while (st < n && !isNum(v[st])) st++;
  if (n - st < p) return o;
  let s = 0; for (let i = st; i < st + p; i++) s += v[i];
  o[st + p - 1] = s / p;
  for (let i = st + p; i < n; i++) o[i] = v[i] * k + o[i - 1] * (1 - k);
  return o;
};
E.sma = (v, p) => {
  const n = v.length, o = new Array(n).fill(NaN); let s = 0;
  for (let i = 0; i < n; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; }
  return o;
};
E.rsi = (c, p = 14) => {
  const o = new Array(c.length).fill(NaN); if (c.length <= p) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; }
  g /= p; l /= p; o[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p; l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
};
E.atr = (h, l, c, p = 14) => {
  const n = c.length, o = new Array(n).fill(NaN); if (n <= p) return o;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let s = 0; for (let i = 1; i <= p; i++) s += tr(i);
  o[p] = s / p;
  for (let i = p + 1; i < n; i++) o[i] = (o[i - 1] * (p - 1) + tr(i)) / p;
  return o;
};
E.macdHist = c => {
  const a = E.ema(c, 12), b = E.ema(c, 26);
  const m = c.map((_, i) => isNum(a[i]) && isNum(b[i]) ? a[i] - b[i] : NaN);
  const s = E.ema(m, 9);
  return m.map((x, i) => isNum(x) && isNum(s[i]) ? x - s[i] : NaN);
};

/* ───────── príprava dát ───────── */
// bar = {t (open time ms), o, h, l, c, v}
E.prep = bars => {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (const b of bars) { t.push(b.t); o.push(b.o); h.push(b.h); l.push(b.l); c.push(b.c); v.push(b.v); }
  return { n: bars.length, t, o, h, l, c, v,
    ema21: E.ema(c, 21), ema50: E.ema(c, 50), ema200: E.ema(c, 200),
    rsi: E.rsi(c, 14), atr: E.atr(h, l, c, 14), hist: E.macdHist(c), vsma: E.sma(v, 20) };
};
// pre každú nižšiu sviečku nájde posledný UZAVRETÝ index vyššieho timeframe (bez lookaheadu)
E.mapHtf = (L, H, ltfMs, htfMs) => {
  const m = new Int32Array(L.n); let j = -1;
  for (let i = 0; i < L.n; i++) {
    const close = L.t[i] + ltfMs;
    while (j + 1 < H.n && H.t[j + 1] + htfMs <= close) j++;
    m[i] = j;
  }
  return m;
};
E.aggregate = (bars, ms) => {
  const out = []; let cur = null;
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== k) { cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; out.push(cur); }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  return out;
};

/* ───────── hodnotenie jednej sviečky ───────── */
// cfg: { minScore }
E.evalAt = (L, H, hj, i, cfg) => {
  if (i < 60 || hj < 55) return null;
  const c = L.c[i], o = L.o[i], atr = L.atr[i], e21 = L.ema21[i], e50 = L.ema50[i], rsi = L.rsi[i];
  const hc = H.c[hj], h50 = H.ema50[hj], h50p = H.ema50[hj - 5], h200 = H.ema200[hj];
  if (![atr, e21, e50, rsi, hc, h50, h50p].every(isNum) || atr <= 0) return null;

  const hUp = hc > h50 && h50 > h50p, hDown = hc < h50 && h50 < h50p;
  const has200 = isNum(h200), hLong = has200 ? h50 > h200 : null;
  const vs = L.vsma[i - 1] || 0;
  const vr = vs > 0 ? L.v[i] / vs : 1;
  const vr3 = vs > 0 ? (L.v[i] + L.v[i - 1] + L.v[i - 2]) / 3 / vs : 1;

  let lo6 = Infinity, rsiMin = Infinity, hh = -Infinity, sw = Infinity, res = -Infinity;
  for (let k = 0; k < 6; k++) lo6 = Math.min(lo6, L.l[i - k]);
  for (let k = 1; k <= 6; k++) rsiMin = Math.min(rsiMin, L.rsi[i - k]);
  for (let k = 1; k <= 20; k++) hh = Math.max(hh, L.h[i - k]);
  for (let k = 0; k < 10; k++) sw = Math.min(sw, L.l[i - k]);
  for (let k = 1; k <= 40; k++) res = Math.max(res, L.h[i - k]);

  const ext = (c - e21) / atr;
  const hot = rsi >= 72 || ext >= 2.5;
  const touched = lo6 <= e21 + 0.2 * atr;
  const dip = rsiMin <= 45;
  const reclaim = c > e21 && c > o && rsi > L.rsi[i - 1];
  const pullback = touched && dip && reclaim && c > e50;
  const breakout = c > hh && vr >= 1.3 && rsi < 75 && ext < 2.5;
  const trigger = pullback ? 'pullback' : breakout ? 'breakout' : null;

  // plán: stop pod swing low (min. 1×ATR, max. 3×ATR), TP1 = 1.5R, TP2 = 3R
  let risk = c - Math.min(sw - 0.15 * atr, c - 1.2 * atr);
  risk = Math.max(atr, Math.min(3 * atr, risk));
  const plan = { entry: c, stop: c - risk, tp1: c + 1.5 * risk, tp2: c + 3 * risk, risk, atr };
  const room = res > c ? (res - c) / risk : Infinity;
  const histUp = L.hist[i] > 0 || L.hist[i] > L.hist[i - 1];

  const parts = {
    trend: (hc > h50 ? 12 : 0) + (h50 > h50p ? 8 : 0) + (hLong === null ? 5 : hLong ? 10 : 0),
    ltf: (c > e50 ? 8 : 0) + (e21 > e50 ? 6 : 0) + (histUp ? 6 : 0),
    entry: (trigger ? 20 : (c > e50 && Math.abs(c - e21) < 0.6 * atr ? 8 : 0)) + (rsi >= 40 && rsi <= 65 ? 6 : rsi <= 70 ? 3 : 0) + (ext < 2 ? 4 : ext < 2.5 ? 2 : 0),
    vol: vr3 >= 1.5 ? 10 : vr3 >= 1.1 ? 6 : vr3 >= 0.8 ? 3 : 0,
    room: room >= 2 ? 10 : room >= 1.5 ? 6 : room >= 1 ? 3 : 0
  };
  const score = parts.trend + parts.ltf + parts.entry + parts.vol + parts.room;

  let state = 'WAIT';
  if (hDown) state = 'AVOID';
  else if (hUp && trigger && !hot && score >= cfg.minScore) state = 'BUY';
  else if (hUp && score >= 45) state = 'WATCH';

  let hint;
  if (state === 'BUY') hint = trigger === 'pullback'
    ? 'Pullback v rastúcom trende – cena sa odrazila od EMA21 a RSI sa otočilo nahor.'
    : `Breakout nad 20-sviečkové maximum s objemom ${vr.toFixed(1).replace('.', ',')}× priemeru.`;
  else if (state === 'AVOID') hint = 'Vyšší timeframe klesá – nekupuj proti trendu.';
  else if (state === 'WAIT') hint = 'Vyšší timeframe nemá jasný rastúci trend – nie je čo naháňať.';
  else if (hot) hint = 'Cena je prehriata – nenaháňaj, počkaj na pullback.';
  else if (trigger) hint = `Spúšťač je, ale kvalita je pod prahom (${score} < ${cfg.minScore}).`;
  else if (touched) hint = 'Cena testuje zónu EMA21 – čaká sa na odraz (zelená sviečka späť nad EMA21).';
  else if (ext > 1.5) hint = 'Cena je ďaleko od EMA21 – počkaj na pullback, nenaháňaj.';
  else hint = 'Trend je zdravý, čaká sa na spúšťač (pullback alebo breakout s objemom).';

  const f = x => x.toFixed(1).replace('.', ',');
  const checks = [
    { ok: hc > h50 && h50 > h50p, label: 'Vyšší TF: rastúci trend', detail: `cena ${hc > h50 ? 'nad' : 'pod'} EMA50, EMA50 ${h50 > h50p ? 'rastie' : 'klesá'}` },
    { ok: hLong, label: 'Vyšší TF: EMA50 nad EMA200', detail: has200 ? (hLong ? 'dlhodobý trend potvrdený' : 'dlhodobý trend slabý') : 'nedostatok histórie' },
    { ok: c > e50 && e21 > e50, label: 'Nižší TF: štruktúra nad EMA50', detail: c > e50 ? (e21 > e50 ? 'EMA21 nad EMA50' : 'cena nad EMA50, EMA21 pod') : 'cena pod EMA50' },
    { ok: histUp, label: 'Momentum (MACD) sa zlepšuje', detail: histUp ? 'histogram rastie / je kladný' : 'histogram slabne' },
    { ok: !!trigger, label: 'Spúšťač vstupu', detail: trigger === 'pullback' ? 'odraz od EMA21' : trigger === 'breakout' ? 'breakout s objemom' : 'zatiaľ nie je' },
    { ok: !hot, label: 'Cena nie je prehriata', detail: `RSI ${rsi.toFixed(0)}, ${f(ext)}× ATR nad EMA21` },
    { ok: vr3 >= 1.1, label: 'Objem nad priemerom', detail: `${f(vr3)}× priemeru` },
    { ok: room >= 1.5, label: 'Priestor do rezistencie ≥ 1,5R', detail: isFinite(room) ? `${f(room)}R do ďalšej rezistencie` : 'žiadna blízka rezistencia' }
  ];
  return { i, t: L.t[i], price: c, score, state, trigger, hint, plan, parts, checks, rsi, vr3, ext, room, hUp, hDown, touched };
};

/* ───────── živý stav: signál platí aj 2 sviečky po vzniku ───────── */
E.live = (L, H, hmap, cfg, price) => {
  const i = L.n - 1;
  const cur = E.evalAt(L, H, hmap[i], i, cfg);
  if (!cur) return null;
  let sig = null;
  for (let k = 0; k < 3 && i - k >= 60; k++) {
    const ev = k === 0 ? cur : E.evalAt(L, H, hmap[i - k], i - k, cfg);
    if (ev && ev.state === 'BUY') { sig = { ev, age: k }; break; }
  }
  let state = cur.state, view = cur, status = null, hint = cur.hint;
  if (sig) {
    const p = sig.ev.plan;
    if (price <= p.stop) status = 'invalid';
    else if (price >= p.entry + 0.6 * p.risk) status = 'late';
    else status = 'active';
    if (status === 'active') { state = 'BUY'; view = sig.ev; hint = sig.ev.hint; }
    else {
      state = 'WATCH'; view = cur;
      hint = status === 'late' ? 'Signál už ušiel o viac ako 0,6R – nenaháňaj, počkaj na ďalší pullback.' : 'Signál bol zrušený – cena klesla pod stop.';
    }
  }
  return { state, ev: view, cur, sig, status, hint, score: view.score };
};

/* ───────── backtest ───────── */
// cfg: { minScore, costPct (na jednu stranu, %), maxBars }
E.backtest = (L, H, hmap, cfg) => {
  const trades = [];
  let i = 60;
  while (i < L.n - 2) {
    const ev = E.evalAt(L, H, hmap[i], i, cfg);
    if (!(ev && ev.state === 'BUY')) { i++; continue; }
    const ei = i + 1, entry = L.o[ei], risk = ev.plan.risk;
    let sl = entry - risk; const tp1 = entry + 1.5 * risk, tp2 = entry + 3 * risk;
    let stage = 0, real = 0, rem = 1, exit = -1, reason = '';
    const last = Math.min(L.n - 1, ei + cfg.maxBars - 1);
    for (let j = ei; j <= last; j++) {
      if (L.l[j] <= sl) { real += rem * (Math.min(sl, L.o[j]) - entry) / risk; rem = 0; exit = j; reason = stage ? 'BE' : 'SL'; break; }
      if (stage === 0 && L.h[j] >= tp1) { real += 0.75; rem = 0.5; stage = 1; sl = entry; continue; }
      if (stage === 1 && L.h[j] >= tp2) { real += 1.5; rem = 0; exit = j; reason = 'TP2'; break; }
    }
    let open = false;
    if (rem > 0) {
      exit = last; real += rem * (L.c[last] - entry) / risk;
      reason = 'TIME'; open = (last === L.n - 1 && last - ei + 1 < cfg.maxBars);
    }
    const r = real - (2 * cfg.costPct / 100 * entry) / risk;
    trades.push({ si: i, ei, t: L.t[ei], entry, stop: entry - risk, r, reason, bars: exit - ei + 1, xi: exit, open });
    i = exit + 1;
  }
  return trades;
};
E.stats = trades => {
  const t = trades.filter(x => !x.open), n = t.length;
  if (!n) return { n: 0, curve: [0] };
  let w = 0, gw = 0, gl = 0, cum = 0, peak = 0, dd = 0, bars = 0; const curve = [0];
  for (const x of t) {
    if (x.r > 0) { w++; gw += x.r; } else gl -= x.r;
    cum += x.r; curve.push(cum); peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); bars += x.bars;
  }
  return { n, wins: w, winRate: w / n, avgR: cum / n, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), totalR: cum, maxDD: dd, curve, avgBars: bars / n };
};
E.verdict = st => {
  if (!st || st.n < 15) return { k: 'low', text: 'Málo obchodov na spoľahlivý záver' };
  if (st.avgR > 0.1 && st.pf >= 1.15) return { k: 'good', text: 'Historicky ziskové' };
  if (st.avgR > 0) return { k: 'mid', text: 'Historicky na hrane' };
  return { k: 'bad', text: 'Historicky stratové – signálu veľmi neverte' };
};
E.runBacktest = (lbars, hbars, m, cfg, now) => {
  lbars = lbars.filter(b => b.t + m.ltfMs <= now); hbars = hbars.filter(b => b.t + m.htfMs <= now);
  const L = E.prep(lbars), H = E.prep(hbars), hmap = E.mapHtf(L, H, m.ltfMs, m.htfMs);
  const trades = E.backtest(L, H, hmap, { minScore: cfg.minScore, costPct: cfg.costPct, maxBars: m.maxBars });
  const st = E.stats(trades);
  const cut = L.t[0] + 0.7 * (L.t[L.n - 1] - L.t[0]);
  const oos = E.stats(trades.filter(x => x.t >= cut));
  const first = L.c[60], bh = L.c[L.n - 1] / first - 1;
  return { L, H, hmap, trades, st, oos, bh, verdict: E.verdict(st), from: L.t[60], to: L.t[L.n - 1] };
};

/* ───────── veľkosť pozície ───────── */
E.sizing = (account, riskPct, entry, stop, costPct) => {
  const riskAmt = account * riskPct / 100, dist = entry - stop;
  if (!(dist > 0) || !(entry > 0)) return null;
  const qty = riskAmt / dist, notional = qty * entry;
  return { riskAmt, qty, notional, feeRT: notional * costPct / 100 * 2, pctOfAccount: notional / account, stopPct: dist / entry };
};

/* ───────── syntetické dáta (demo režim + testy) ───────── */
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
E.synth15 = (sym, n, now) => {
  const r = rng(hash(sym)), g = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7071; };
  const base = Math.pow(10, 1 + r() * 4), step = 900e3, end = Math.floor(now / step) * step;
  let p = base, drift = 0, left = 0, vol = 0.002 + r() * 0.002;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) { drift = (r() - 0.46) * 0.0006; left = 300 + r() * 900; vol = 0.0015 + r() * 0.003; }
    const o = p, ret = drift + vol * g(); p = o * Math.exp(ret);
    const h = Math.max(o, p) * (1 + Math.abs(g()) * vol * 0.4), l = Math.min(o, p) * (1 - Math.abs(g()) * vol * 0.4);
    out.push({ t: end - (n - 1 - i) * step, o, h, l, c: p, v: 100 * (1 + Math.abs(ret) / vol) * Math.exp(g() * 0.3) });
  }
  return out;
};

if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.Engine = E;
})(typeof self !== 'undefined' ? self : this);
