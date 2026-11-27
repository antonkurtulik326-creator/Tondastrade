/* Trade Radar – engine: indikátory, hodnotenie signálu, backtest. Čistá logika bez DOM. */
(function (root) {
'use strict';
const E = {};
const isNum = Number.isFinite;

/* ───────── základné indikátory ───────── */
E.ema = (v, p) => {
  const n = v.length, o = new Array(n).fill(NaN), k = 2 / (p + 1);
  let st = 0; while (st < n && !isNum(v[st])) st++;
  if (n - st < p) return o;
  let s = 0; for (let i = st; i < st + p; i++) s += v[i];
  o[st + p - 1] = s / p;
  for (let i = st + p; i < n; i++) o[i] = v[i] * k + o[i - 1] * (1 - k);
  return o;
};
E.sma = (v, p) => { // toleruje NaN na začiatku
  const n = v.length, o = new Array(n).fill(NaN); let s = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!isNum(v[i])) { s = 0; cnt = 0; continue; }
    s += v[i]; cnt++;
    if (cnt > p) { s -= v[i - p]; cnt = p; }
    if (cnt >= p) o[i] = s / p;
  }
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
E.macd = c => {
  const a = E.ema(c, 12), b = E.ema(c, 26);
  const m = c.map((_, i) => isNum(a[i]) && isNum(b[i]) ? a[i] - b[i] : NaN);
  const s = E.ema(m, 9);
  return { line: m, signal: s, hist: m.map((x, i) => isNum(x) && isNum(s[i]) ? x - s[i] : NaN) };
};
E.boll = (c, p = 20, k = 2) => {
  const n = c.length, m = E.sma(c, p), u = new Array(n).fill(NaN), lo = new Array(n).fill(NaN), w = new Array(n).fill(NaN);
  for (let i = p - 1; i < n; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) { const d = c[j] - m[i]; s += d * d; }
    const sd = Math.sqrt(s / p); u[i] = m[i] + k * sd; lo[i] = m[i] - k * sd; w[i] = m[i] ? (u[i] - lo[i]) / m[i] : NaN;
  }
  return { m, u, l: lo, w };
};
E.stochRsi = (r, p = 14, ks = 3, ds = 3) => {
  const n = r.length, raw = new Array(n).fill(NaN);
  for (let i = p - 1; i < n; i++) {
    let mn = Infinity, mx = -Infinity, ok = true;
    for (let j = i - p + 1; j <= i; j++) { if (!isNum(r[j])) { ok = false; break; } mn = Math.min(mn, r[j]); mx = Math.max(mx, r[j]); }
    if (ok) raw[i] = mx > mn ? (r[i] - mn) / (mx - mn) * 100 : 50;
  }
  const k = E.sma(raw, ks); return { k, d: E.sma(k, ds) };
};
E.obv = (c, v) => { const o = [0]; for (let i = 1; i < c.length; i++) o.push(o[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0)); return o; };
E.vwap = (t, h, l, c, v) => { // denný VWAP (reset o polnoci UTC)
  const n = c.length, o = new Array(n); let day = -1, pv = 0, vv = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(t[i] / 864e5); if (d !== day) { day = d; pv = 0; vv = 0; }
    const tp = (h[i] + l[i] + c[i]) / 3; pv += tp * v[i]; vv += v[i]; o[i] = vv > 0 ? pv / vv : tp;
  }
  return o;
};
E.adx = (h, l, c, p = 14) => {
  const n = c.length, adx = new Array(n).fill(NaN), pdi = new Array(n).fill(NaN), mdi = new Array(n).fill(NaN), dx = new Array(n).fill(NaN);
  if (n < 2 * p + 1) return { adx, pdi, mdi };
  let tr = 0, pdm = 0, mdm = 0;
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    const pm = up > dn && up > 0 ? up : 0, mm = dn > up && dn > 0 ? dn : 0;
    const t = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    if (i <= p) { tr += t; pdm += pm; mdm += mm; if (i < p) continue; }
    else { tr = tr - tr / p + t; pdm = pdm - pdm / p + pm; mdm = mdm - mdm / p + mm; }
    const P = tr ? 100 * pdm / tr : 0, Mi = tr ? 100 * mdm / tr : 0;
    pdi[i] = P; mdi[i] = Mi; dx[i] = P + Mi ? 100 * Math.abs(P - Mi) / (P + Mi) : 0;
    if (i === 2 * p - 1) { let s = 0; for (let j = p; j <= i; j++) s += dx[j]; adx[i] = s / p; }
    else if (i > 2 * p - 1) adx[i] = (adx[i - 1] * (p - 1) + dx[i]) / p;
  }
  return { adx, pdi, mdi };
};
const PIV = 5;
E.pivots = (h, l, k = PIV) => {
  const n = h.length, ph = new Uint8Array(n), pl = new Uint8Array(n);
  for (let i = k; i < n - k; i++) {
    let hi = true, lo = true;
    for (let j = 1; j <= k && (hi || lo); j++) {
      if (h[i - j] >= h[i] || h[i + j] > h[i]) hi = false;
      if (l[i - j] <= l[i] || l[i + j] < l[i]) lo = false;
    }
    ph[i] = hi ? 1 : 0; pl[i] = lo ? 1 : 0;
  }
  return { ph, pl };
};

/* ───────── príprava dát ───────── */
// bar = {t (čas otvorenia ms), o, h, l, c, v}
E.prep = bars => {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (const b of bars) { t.push(b.t); o.push(b.o); h.push(b.h); l.push(b.l); c.push(b.c); v.push(b.v); }
  const md = E.macd(c), bb = E.boll(c), rsi = E.rsi(c, 14), st = E.stochRsi(rsi), ob = E.obv(c, v), ad = E.adx(h, l, c), pv = E.pivots(h, l);
  return { n: bars.length, t, o, h, l, c, v,
    ema21: E.ema(c, 21), ema50: E.ema(c, 50), ema200: E.ema(c, 200),
    rsi, atr: E.atr(h, l, c, 14), hist: md.hist, macd: md.line, macdSig: md.signal, vsma: E.sma(v, 20),
    bbU: bb.u, bbM: bb.m, bbL: bb.l, bbW: bb.w, stK: st.k, stD: st.d, obv: ob, obvE: E.ema(ob, 20),
    vwap: E.vwap(t, h, l, c, v), adx: ad.adx, pdi: ad.pdi, mdi: ad.mdi, ph: pv.ph, pl: pv.pl };
};
// pre každú nižšiu sviečku: posledný UZAVRETÝ index vyššieho TF (bez pohľadu do budúcnosti)
E.mapHtf = (L, H, ltfMs, htfMs) => {
  const m = new Int32Array(L.n); let j = -1;
  for (let i = 0; i < L.n; i++) {
    const close = L.t[i] + ltfMs;
    while (j + 1 < H.n && H.t[j + 1] + htfMs <= close) j++;
    m[i] = j;
  }
  return m;
};
E.aggregate = (bars, ms) => { // podľa času (krypto 24/7)
  const out = []; let cur = null;
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== k) { cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; out.push(cur); }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  return out;
};
E.aggSession = (bars, n) => { // akcie: v rámci dňa po n sviečkach (n = Infinity → denná sviečka)
  const out = []; let cur = null, day = -1, cnt = 0;
  for (const b of bars) {
    const d = Math.floor(b.t / 864e5);
    if (!cur || d !== day || cnt >= n) {
      cur = { t: n === Infinity ? d * 864e5 : b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; out.push(cur); day = d; cnt = 1;
    } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; cnt++; }
  }
  return out;
};

/* ───────── pomocné analýzy na sviečke i ───────── */
E.fibAt = (L, i, look = 120) => {
  const a = Math.max(0, i - look + 1);
  let hiI = a; for (let j = a; j <= i; j++) if (L.h[j] >= L.h[hiI]) hiI = j;
  let loI = a; for (let j = a; j <= hiI; j++) if (L.l[j] <= L.l[loI]) loI = j;
  const hi = L.h[hiI], lo = L.l[loI], rng = hi - lo, atr = L.atr[i];
  if (!(rng > 0) || hiI - loI < 5 || !(rng >= 4 * atr)) return null;
  let low = Infinity; for (let j = Math.max(hiI, i - 5); j <= i; j++) low = Math.min(low, L.l[j]);
  const lv = r => hi - rng * r;
  const deep = (hi - low) / rng;
  return { hi, lo, hiI, loI, rng, deep, ret: (hi - L.c[i]) / rng,
    inZone: deep >= 0.35 && deep <= 0.67 && L.c[i] > lv(0.786), golden: deep >= 0.5 && deep <= 0.67,
    levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(r => ({ r, p: lv(r) })),
    ext: [1.272, 1.618].map(r => ({ r, p: lo + rng * r })) };
};
E.srAt = (L, i, look = 200) => {
  let res = Infinity, sup = -Infinity; const c = L.c[i];
  for (let j = i - PIV; j >= Math.max(PIV, i - look); j--) {
    if (L.ph[j] && L.h[j] > c && L.h[j] < res) res = L.h[j];
    if (L.pl[j] && L.l[j] < c && L.l[j] > sup) sup = L.l[j];
  }
  return { res, sup };
};
const patternAt = (L, i) => {
  const o = L.o[i], c = L.c[i], h = L.h[i], l = L.l[i], po = L.o[i - 1], pc = L.c[i - 1];
  const body = Math.abs(c - o), rng = (h - l) || 1e-12;
  if (pc < po && c > o && c >= po && o <= pc && body >= Math.abs(pc - po) * 0.9) return 'bullish engulfing';
  const lw = Math.min(o, c) - l, uw = h - Math.max(o, c);
  if (lw >= 2 * body && uw <= body + rng * 0.1 && lw / rng >= 0.55) return 'kladivo (hammer)';
  return null;
};
const divergenceAt = (L, i) => {
  let a = i; for (let j = i - 7; j <= i; j++) if (L.l[j] < L.l[a]) a = j;
  let b = i - 30; for (let j = i - 30; j <= i - 10; j++) if (L.l[j] < L.l[b]) b = j;
  return L.l[a] < L.l[b] && L.rsi[a] > L.rsi[b] + 3 && L.rsi[b] < 40;
};

/* ───────── hodnotenie jednej sviečky ───────── */
// cfg: { minScore, filters: { adx, fib, vwap, obv, candle } }
const f1 = x => x.toFixed(1).replace('.', ',');
const pctTxt = x => Math.round(x * 100) + ' %';
E.evalAt = (L, H, hj, i, cfg) => {
  if (i < 60 || hj < 55) return null;
  const c = L.c[i], o = L.o[i], atr = L.atr[i], e21 = L.ema21[i], e50 = L.ema50[i], rsi = L.rsi[i];
  const hc = H.c[hj], h50 = H.ema50[hj], h50p = H.ema50[hj - 5], h200 = H.ema200[hj];
  if (![atr, e21, e50, rsi, hc, h50, h50p].every(isNum) || atr <= 0) return null;
  const fl = cfg.filters || {};

  // trend vyššieho TF
  const hUp = hc > h50 && h50 > h50p, hDown = hc < h50 && h50 < h50p;
  const has200 = isNum(h200), hLong = has200 ? h50 > h200 : null;
  const hAdx = H.adx[hj], hP = H.pdi[hj], hM = H.mdi[hj];
  const adxOk = isNum(hAdx) && hAdx >= 20 && hP > hM;

  // objem
  const vs = L.vsma[i - 1] || 0;
  const vr = vs > 0 ? L.v[i] / vs : 1, vr3 = vs > 0 ? (L.v[i] + L.v[i - 1] + L.v[i - 2]) / 3 / vs : 1;
  const aboveVwap = c > L.vwap[i];
  const obvUp = L.obv[i] > L.obvE[i];

  let lo6 = Infinity, rsiMin = Infinity, hh = -Infinity, sw = Infinity, wMin = Infinity;
  for (let k = 0; k < 6; k++) lo6 = Math.min(lo6, L.l[i - k]);
  for (let k = 1; k <= 6; k++) rsiMin = Math.min(rsiMin, L.rsi[i - k]);
  for (let k = 1; k <= 20; k++) hh = Math.max(hh, L.h[i - k]);
  for (let k = 0; k < 10; k++) sw = Math.min(sw, L.l[i - k]);
  for (let k = 2; k <= 60; k++) if (isNum(L.bbW[i - k])) wMin = Math.min(wMin, L.bbW[i - k]);

  // konfluencie
  const fib = E.fibAt(L, i), sr = E.srAt(L, i);
  const fibZone = !!(fib && fib.inZone);
  const touchedEma = lo6 <= e21 + 0.2 * atr;
  const bbTouch = isNum(L.bbL[i]) && lo6 <= L.bbL[i] + 0.15 * atr;
  const atSup = isFinite(sr.sup) && Math.abs(lo6 - sr.sup) <= 0.4 * atr;
  const squeeze = isNum(L.bbW[i - 1]) && L.bbW[i - 1] <= wMin * 1.15;
  const pattern = patternAt(L, i) || patternAt(L, i - 1);
  const div = divergenceAt(L, i);
  let stCross = false;
  for (let j = i - 3; j <= i; j++) if (L.stK[j] > L.stD[j] && L.stK[j - 1] <= L.stD[j - 1] && Math.min(L.stK[j - 1], L.stD[j - 1]) < 25) stCross = true;

  // spúšťače
  const ext = (c - e21) / atr;
  const hot = rsi >= 72 || ext >= 2.5;
  const zone = touchedEma || fibZone || bbTouch || atSup;
  const dip = rsiMin <= 45 || stCross;
  const reversal = c > o && rsi > L.rsi[i - 1] && (c > e21 || c > L.h[i - 1] || !!pattern);
  const pullback = zone && dip && reversal && (c > e50 || fibZone);
  const breakout = c > hh && vr >= 1.3 && rsi < 75 && ext < 2.5;
  const trigger = pullback ? 'pullback' : breakout ? 'breakout' : null;

  // plán: stop pod swing low (1–3× ATR), TP1 = 1,5R, TP2 = 3R
  let risk = c - Math.min(sw - 0.15 * atr, c - 1.2 * atr);
  risk = Math.max(atr, Math.min(3 * atr, risk));
  const plan = { entry: c, stop: c - risk, tp1: c + 1.5 * risk, tp2: c + 3 * risk, risk, atr };
  const room = sr.res < Infinity ? (sr.res - c) / risk : Infinity;
  const histUp = L.hist[i] > 0 || L.hist[i] > L.hist[i - 1];
  const nearZone = c > e50 && Math.abs(c - e21) < 0.6 * atr;

  const P = {
    trend: (hc > h50 ? 8 : 0) + (h50 > h50p ? 6 : 0) + (hLong === null ? 3 : hLong ? 6 : 0) + (adxOk ? 5 : isNum(hAdx) && hAdx >= 15 && hP > hM ? 2 : 0),
    struct: (c > e50 ? 6 : 0) + (e21 > e50 ? 5 : 0) + (obvUp ? 4 : 0),
    entry: Math.min(25, (trigger ? 13 : nearZone || zone ? 5 : 0) + (fibZone || (trigger === 'breakout' && squeeze) ? 4 : 0) + (atSup || bbTouch ? 4 : 0) + (pattern ? 4 : 0)),
    mom: (histUp ? 4 : 0) + (rsi >= 40 && rsi <= 65 ? 4 : rsi <= 70 ? 2 : 0) + (stCross ? 4 : 0) + (div ? 3 : 0),
    vol: (vr3 >= 1.5 ? 6 : vr3 >= 1.1 ? 4 : vr3 >= 0.8 ? 2 : 0) + (aboveVwap ? 4 : 0),
    risk: (room >= 2 ? 6 : room >= 1.5 ? 4 : room >= 1 ? 2 : 0) + (ext < 2 ? 4 : ext < 2.5 ? 2 : 0)
  };
  const score = P.trend + P.struct + P.entry + P.mom + P.vol + P.risk;

  // povinné filtre (voliteľné v nastaveniach)
  const failed = [];
  if (fl.adx && !adxOk) failed.push('ADX');
  if (fl.fib && trigger === 'pullback' && !fibZone) failed.push('Fibonacci');
  if (fl.vwap && !aboveVwap) failed.push('VWAP');
  if (fl.obv && !obvUp) failed.push('OBV');
  if (fl.candle && !pattern) failed.push('sviečkový vzor');

  let state = 'WAIT';
  if (hDown) state = 'AVOID';
  else if (hUp && trigger && !hot && score >= cfg.minScore && !failed.length) state = 'BUY';
  else if (hUp && score >= 45) state = 'WATCH';

  const conf = [touchedEma && 'EMA21', fibZone && `Fibonacci ${pctTxt(fib.deep)}`, atSup && 'podpora', bbTouch && 'dolné Bollingerovo pásmo'].filter(Boolean);
  let hint;
  if (state === 'BUY') hint = trigger === 'pullback'
    ? `Pullback v rastúcom trende – odraz od: ${conf.join(', ') || 'zóny hodnoty'}.${pattern ? ` Potvrdené sviečkou (${pattern}).` : ''}${div ? ' Bullish divergencia RSI.' : ''}`
    : `Breakout nad 20-sviečkové maximum s objemom ${f1(vr)}× priemeru${squeeze ? ' po zúžení Bollingerových pásiem' : ''}.`;
  else if (state === 'AVOID') hint = 'Vyšší timeframe klesá – nekupuj proti trendu.';
  else if (state === 'WAIT') hint = 'Vyšší timeframe nemá jasný rastúci trend – nie je čo naháňať.';
  else if (hot) hint = 'Cena je prehriata – nenaháňaj, počkaj na pullback.';
  else if (trigger && failed.length) hint = `Spúšťač je, ale nespĺňa povinné filtre: ${failed.join(', ')}.`;
  else if (trigger) hint = `Spúšťač je, ale kvalita je pod prahom (${score} < ${cfg.minScore}).`;
  else if (fibZone) hint = `Cena je vo Fibonacciho zóne (${pctTxt(fib.deep)}) – čaká sa na potvrdzujúcu zelenú sviečku.`;
  else if (zone) hint = `Cena testuje zónu ${touchedEma ? 'EMA21' : atSup ? 'podpory' : 'dolného Bollingerovho pásma'} – čaká sa na odraz.`;
  else if (ext > 1.5) hint = 'Cena je ďaleko od EMA21 – počkaj na pullback, nenaháňaj.';
  else hint = 'Trend je zdravý, čaká sa na spúšťač (pullback alebo breakout s objemom).';

  const groups = [
    { k: 'trend', name: 'Trend vyššieho TF', pts: P.trend, max: 25, items: [
      { ok: hc > h50 && h50 > h50p, label: 'Rastúci trend (EMA50)', detail: `cena ${hc > h50 ? 'nad' : 'pod'} EMA50, EMA50 ${h50 > h50p ? 'rastie' : 'klesá'}` },
      { ok: hLong, label: 'EMA50 nad EMA200', detail: has200 ? (hLong ? 'dlhodobý trend potvrdený' : 'dlhodobý trend slabý') : 'nedostatok histórie' },
      { ok: isNum(hAdx) ? adxOk : null, label: 'Sila trendu ADX ≥ 20', detail: isNum(hAdx) ? `ADX ${hAdx.toFixed(0)}, +DI ${hP > hM ? '>' : '<'} −DI` : 'nedostatok histórie' } ] },
    { k: 'struct', name: 'Štruktúra', pts: P.struct, max: 15, items: [
      { ok: c > e50 && e21 > e50, label: 'Cena a EMA21 nad EMA50', detail: c > e50 ? (e21 > e50 ? 'zdravá štruktúra' : 'EMA21 ešte pod EMA50') : 'cena pod EMA50' },
      { ok: obvUp, label: 'Akumulácia (OBV)', detail: obvUp ? 'OBV nad svojím priemerom – nákupy prevažujú' : 'OBV pod priemerom – distribúcia' } ] },
    { k: 'entry', name: 'Vstup a konfluencia', pts: P.entry, max: 25, items: [
      { ok: !!trigger, label: 'Spúšťač vstupu', detail: trigger === 'pullback' ? 'pullback s odrazom' : trigger === 'breakout' ? 'breakout s objemom' : 'zatiaľ nie je' },
      { ok: fib ? fibZone : null, label: 'Fibonacci retracement 38–62 %', detail: fib ? `pullback na ${pctTxt(fib.deep)} posledného vlnového pohybu${fib.golden ? ' (zlatá zóna)' : ''}` : 'nie je výrazný pohyb na meranie' },
      { ok: atSup || bbTouch, label: 'Podpora / dolné Bollinger pásmo', detail: atSup ? 'cena sa dotkla podpory' : bbTouch ? 'odraz od dolného pásma' : 'bez dotyku' },
      { ok: !!pattern, label: 'Sviečkový vzor', detail: pattern || 'žiadny býčí vzor' } ] },
    { k: 'mom', name: 'Momentum', pts: P.mom, max: 15, items: [
      { ok: histUp, label: 'MACD sa zlepšuje', detail: histUp ? 'histogram rastie / je kladný' : 'histogram slabne' },
      { ok: rsi >= 40 && rsi <= 65, label: 'RSI v zdravej zóne', detail: `RSI ${rsi.toFixed(0)}` },
      { ok: stCross, label: 'Stoch RSI otočenie z prepredania', detail: isNum(L.stK[i]) ? `K ${L.stK[i].toFixed(0)} / D ${L.stD[i].toFixed(0)}` : '—' },
      { ok: div, label: 'Bullish divergencia RSI', detail: div ? 'cena nižšie dno, RSI vyššie dno' : 'nie je' } ] },
    { k: 'vol', name: 'Objem', pts: P.vol, max: 10, items: [
      { ok: vr3 >= 1.1, label: 'Objem nad priemerom', detail: `${f1(vr3)}× priemeru` },
      { ok: aboveVwap, label: 'Cena nad VWAP', detail: aboveVwap ? 'kupujúci majú navrch' : 'cena pod priemernou cenou dňa' } ] },
    { k: 'risk', name: 'Riziko a priestor', pts: P.risk, max: 10, items: [
      { ok: room >= 1.5, label: 'Priestor do rezistencie ≥ 1,5R', detail: isFinite(room) ? `${f1(room)}R do ${room < 0 ? '' : 'najbližšej '}rezistencie` : 'žiadna blízka rezistencia' },
      { ok: !hot, label: 'Cena nie je prehriata', detail: `${f1(ext)}× ATR nad EMA21` } ] }
  ];
  return { i, t: L.t[i], price: c, score, state, trigger, hint, plan, P, groups, failed, fib, sr, rsi, vr3, ext, room, hUp, hDown, pattern, div, squeeze };
};

/* ───────── živý stav: signál platí ešte 2 sviečky po vzniku ───────── */
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
    status = price <= p.stop ? 'invalid' : price >= p.entry + 0.6 * p.risk ? 'late' : 'active';
    if (status === 'active') { state = 'BUY'; view = sig.ev; hint = sig.ev.hint; }
    else { state = 'WATCH'; hint = status === 'late' ? 'Signál už ušiel o viac ako 0,6R – nenaháňaj, počkaj na ďalší pullback.' : 'Signál bol zrušený – cena klesla pod stop.'; }
  }
  return { state, ev: view, cur, sig, status, hint, score: view.score };
};

/* ───────── backtest ───────── */
// cfg: { minScore, filters, costPct (na stranu, %), maxBars }
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
    if (rem > 0) { exit = last; real += rem * (L.c[last] - entry) / risk; reason = 'TIME'; open = last === L.n - 1 && last - ei + 1 < cfg.maxBars; }
    const r = real - (2 * cfg.costPct / 100 * entry) / risk;
    trades.push({ si: i, ei, t: L.t[ei], entry, stop: entry - risk, r, reason, bars: exit - ei + 1, xi: exit, open, trig: ev.trigger });
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
E.runBacktest = (L, H, hmap, m, cfg) => {
  const trades = E.backtest(L, H, hmap, { minScore: cfg.minScore, filters: cfg.filters, costPct: cfg.costPct, maxBars: m.maxBars });
  const st = E.stats(trades);
  const cut = L.t[60] + 0.7 * (L.t[L.n - 1] - L.t[60]);
  const oos = E.stats(trades.filter(x => x.t >= cut));
  const bh = L.c[L.n - 1] / L.c[60] - 1;
  return { trades, st, oos, bh, verdict: E.verdict(st), from: L.t[60], to: L.t[L.n - 1] };
};

/* ───────── veľkosť pozície ───────── */
E.sizing = (account, riskPct, entry, stop, costPct) => {
  const riskAmt = account * riskPct / 100, dist = entry - stop;
  if (!(dist > 0) || !(entry > 0)) return null;
  const qty = riskAmt / dist, notional = qty * entry;
  return { riskAmt, qty, notional, feeRT: notional * costPct / 100 * 2, stopPct: dist / entry };
};

/* ───────── syntetické dáta (iba DEMO režim a testy) ───────── */
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
E.synth15 = (sym, n, now, session) => {
  const r = rng(hash(sym)), g = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7071; };
  const base = Math.pow(10, 1 + r() * 3), step = 900e3, end = Math.floor(now / step) * step;
  let p = base, drift = 0, left = 0, vol = 0.002 + r() * 0.002;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = end - (n - 1 - i) * step;
    if (session) { const d = new Date(t), wd = d.getUTCDay(), mins = d.getUTCHours() * 60 + d.getUTCMinutes(); if (wd === 0 || wd === 6 || mins < 870 || mins >= 1260) continue; }
    if (left-- <= 0) { drift = (r() - 0.46) * 0.0006; left = 300 + r() * 900; vol = (session ? 0.0012 : 0.0015) + r() * 0.003; }
    const o = p, ret = drift + vol * g(); p = o * Math.exp(ret);
    const h = Math.max(o, p) * (1 + Math.abs(g()) * vol * 0.4), l = Math.min(o, p) * (1 - Math.abs(g()) * vol * 0.4);
    out.push({ t, o, h, l, c: p, v: 100 * (1 + Math.abs(ret) / vol) * Math.exp(g() * 0.3) });
  }
  return out;
};

if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.Engine = E;
})(typeof self !== 'undefined' ? self : this);
