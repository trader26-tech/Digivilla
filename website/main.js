/* Digivilla — Apple-style scroll engine. No dependencies.
   Every pinned chapter exposes progress p ∈ [0,1]; beats (headlines) and
   visuals are cross-faded and scrubbed from p. Scroll is lerped on
   pointer devices for the silky feel; direct on touch. */
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function fmtINR(n, decimals) {
    const neg = n < 0; n = Math.abs(n);
    let s = decimals ? n.toFixed(decimals) : Math.round(n).toString();
    let [int, dec] = s.split('.');
    if (int.length > 3) { const last3 = int.slice(-3); let rest = int.slice(0, -3); rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ','); int = rest + ',' + last3; }
    return (neg ? '−' : '') + int + (dec ? '.' + dec : '');
  }
  function fmtShort(n) {
    if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    return '₹' + fmtINR(n);
  }

  /* ---------- beat / visual windowing (Apple-style in → hold → out) ---------- */
  // local ∈ (-inf, inf): 0..1 is this beat's window. Returns {o, y}
  function win(local, first, last) {
    let o;
    if (local < 0) o = first ? 1 : smooth(1 + local * 4);          // fade in over the last 25% of the previous window
    else if (local < 0.75) o = 1;
    else o = last ? 1 : smooth(1 - (local - 0.75) * 4);             // fade out over the last 25%
    const y = local < 0 ? -local * 48 : local > 0.75 && !last ? -(local - 0.75) * 48 : 0;
    return { o: clamp(o, 0, 1), y };
  }
  function applyBeats(root, n, p) {
    const beats = $$('.beat', root), vis = $$('.vis', root), dots = $$('.dots i', root);
    const cur = Math.min(n - 1, Math.floor(p * n));
    beats.forEach((b, i) => {
      const w = win(p * n - i, i === 0, i === n - 1);
      b.style.opacity = w.o.toFixed(3);
      b.style.transform = 'translate3d(0,' + w.y.toFixed(1) + 'px,0)';
      b.style.pointerEvents = i === cur ? 'auto' : 'none';
    });
    vis.forEach((v, i) => {
      const local = p * n - i, w = win(local, i === 0, i === n - 1);
      const s = local < 0 ? 0.94 + 0.06 * w.o : local > 0.75 ? 1 + (1 - w.o) * 0.04 : 1;
      v.style.opacity = w.o.toFixed(3);
      v.style.transform = 'translate3d(0,' + (w.y * 0.6).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')';
      v.style.pointerEvents = i === cur ? 'auto' : 'none';
    });
    dots.forEach((d, i) => d.classList.toggle('active', i === cur));
    return { cur, sub: clamp(p * n - cur, 0, 1) };
  }

  /* ---------- chapters ---------- */
  const chapters = [];
  function chapter(id, n, fn) { const el = $('#' + id); if (el) chapters.push({ el, n, fn, last: -1 }); }

  // FLAT
  const units = $$('#units i'), stamp = $('#stamp');
  chapter('flat', 5, (p, root) => {
    const { cur, sub } = applyBeats(root, 5, p);
    // 0 · price count
    const price = $('#priceFig'); if (cur === 0) price.textContent = '₹' + fmtINR(10000000 * easeOut(clamp(sub * 1.6, 0, 1)));
    // 1 · ring
    const k = cur === 1 ? easeOut(clamp(sub * 1.4, 0, 1)) : cur > 1 ? 1 : 0;
    $('#ringKeep').style.strokeDashoffset = (754 - 648.4 * k).toFixed(1);
    const l = cur === 1 ? easeOut(clamp((sub - 0.45) * 2.2, 0, 1)) : cur > 1 ? 1 : 0;
    $('#ringLost').style.strokeDashoffset = (754 - 105.6 * l).toFixed(1);
    // 2 · funnel
    $$('.fbar', root).forEach((b, i) => { const s = cur === 2 ? easeOut(clamp(sub * 2.2 - i * 0.28, 0, 1)) : cur > 2 ? 1 : 0; b.style.setProperty('--s', s.toFixed(3)); });
    // 3 · units + stamp
    const on = cur === 3 ? Math.round(easeOut(clamp(sub * 1.6, 0, 1)) * 20) : cur > 3 ? 20 : 0;
    units.forEach((u, i) => u.classList.toggle('on', i >= 100 - on));
    const st = cur === 3 ? easeOut(clamp((sub - 0.35) * 2.5, 0, 1)) : cur > 3 ? 1 : 0;
    stamp.style.setProperty('--o', st.toFixed(3)); stamp.style.setProperty('--s', (1.6 - 0.6 * st).toFixed(3));
    // 4 · race
    const rf = cur === 4 ? clamp(sub * 3, 0, 1) : 0, rs = cur === 4 ? clamp(sub * 1.15, 0, 1) : 0;
    $('#raceFast').style.setProperty('--s', rf.toFixed(3)); $('#raceSlow').style.setProperty('--s', rs.toFixed(3));
  });

  // BUILD: pair → villa → donut
  chapter('build', 3, (p, root) => {
    const { cur, sub } = applyBeats(root, 3, p);
    const pv = $('#pairVault'), pt = $('#pairTree');
    // the two halves drift together as the beat ends
    const merge = cur === 0 ? smooth((sub - 0.6) / 0.4) : cur > 0 ? 1 : 0;
    pv.style.transform = 'translate3d(' + (merge * 60).toFixed(1) + 'px,0,0)';
    pt.style.transform = 'translate3d(' + (-merge * 60).toFixed(1) + 'px,0,0)';
    // donut draws
    $$('.seg', root).forEach((seg, i) => {
      const pct = parseFloat(seg.dataset.pct) / 100;
      const s = cur === 2 ? easeOut(clamp(sub * 2.4 - i * 0.22, 0, 1)) : 0;
      seg.style.strokeDashoffset = (816.8 * (1 - pct * s)).toFixed(1);
    });
  });

  // STAGES
  chapter('stages', 5, (p, root) => {
    const { cur } = applyBeats(root, 5, p);
    $$('.stage-svg', root).forEach((s, i) => {
      const local = p * 5 - i, w = win(local, i === 0, i === 4);
      const sc = local < 0 ? 0.96 + 0.04 * w.o : local > 0.75 && i !== 4 ? 1 + (1 - w.o) * 0.03 : 1;
      s.style.opacity = w.o.toFixed(3);
      s.style.transform = 'translate3d(0,' + (w.y * 0.5).toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';
    });
    $('#stageFill').style.transform = 'scaleX(' + p.toFixed(4) + ')';
    void cur;
  });

  /* ---------- the estate board (estate-home): generated from invested ₹ ---------- */
  const ORDER = [[1, 1], [2, 2], [1, 2], [2, 1], [0, 2], [2, 0], [0, 1], [1, 0], [0, 0]];
  const L = 100000, VILLA = 5 * L, MAX = 45 * L;
  const TILE_W = 187.2, TILE_H = 108, OX = 320, OY = 118;
  const STAGE_SYM = ['#tGround', '#tLand', '#tGrade', '#tFound', '#tSteel'];
  const cellsG = $('#boardCells'), lvlNum = $('#lvlNum'), lvlWorth = $('#lvlWorth');
  const NS = 'http://www.w3.org/2000/svg';
  const cellState = new Map();
  let boardKey = '';
  function cellPos(r, c) { return { x: OX + (c - r) * TILE_W / 2, y: OY + (c + r) * TILE_H / 2 }; }
  function paintBoard(invested) {
    invested = clamp(invested, 0, MAX);
    const villas = Math.min(9, Math.floor(invested / VILLA));
    const buildStage = Math.floor((invested - villas * VILLA) / L);
    lvlNum.textContent = Math.min(45, Math.floor(invested / L) + 1);
    lvlWorth.textContent = '₹' + fmtINR(invested);
    const key = villas + ':' + buildStage;
    if (key === boardKey) return; boardKey = key;
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const idx = ORDER.findIndex((o) => o[0] === r && o[1] === c);
      let href = '#tLocked';
      if (idx < villas) href = '#tVilla';
      else if (idx === villas && villas < 9) href = STAGE_SYM[buildStage];
      cells.push({ r, c, href });
    }
    cells.sort((a, b) => (a.r + a.c) - (b.r + b.c) || a.c - b.c);
    while (cellsG.firstChild) cellsG.removeChild(cellsG.firstChild);
    cells.forEach((cl) => {
      const k = cl.r + ',' + cl.c, prev = cellState.get(k), { x, y } = cellPos(cl.r, cl.c);
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'cell');
      g.setAttribute('transform', 'translate(' + (x - 120).toFixed(1) + ',' + (y - 80).toFixed(1) + ')');
      const use = document.createElementNS(NS, 'use');
      use.setAttribute('href', cl.href); use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', cl.href);
      if (prev && prev !== cl.href && !reduce) use.setAttribute('class', 'pop');
      g.appendChild(use); cellsG.appendChild(g); cellState.set(k, cl.href);
    });
    if (villas > 0) {
      const { x, y } = cellPos(1, 1);
      const coin = document.createElementNS(NS, 'g');
      coin.setAttribute('transform', 'translate(' + x + ',' + (y + 44) + ')');
      coin.innerHTML = '<ellipse class="cf-shadow" cx="0" cy="30" rx="13" ry="4.5"></ellipse><g class="coin-float"><circle class="cf-face" r="15"></circle><circle class="cf-ring" r="10"></circle><circle class="cf-shine" cx="-3.8" cy="-4.5" r="3"></circle><text class="cf-glyph" x="0" y="5.5" text-anchor="middle">₹</text></g>';
      cellsG.appendChild(coin);
    }
  }
  paintBoard(0);
  chapter('estate', 3, (p, root) => {
    applyBeats(root, 3, p);
    paintBoard(Math.round(clamp(p * 1.06, 0, 1) * 45) * L);
    const bv = $('.board-visual', root);
    bv.style.transform = 'scale(' + (0.92 + 0.08 * smooth(p * 3)).toFixed(4) + ')';
  });

  /* ---------- hero scrub + mouse tilt ---------- */
  const hero = $('#hero'), heroCopy = $('#heroCopy'), heroArt = $('#heroArt'), villaStage = $('#villaStage');
  const heroLayers = $$('.hero-scene .layer[data-depth]');
  let mouseX = 0, mouseY = 0, tiltX = 0, tiltY = 0;
  function heroScrub(y) {
    const h = hero.offsetHeight; if (y > h * 1.2) return;
    const t = clamp(y / (h * 0.8), 0, 1);
    heroCopy.style.opacity = (1 - smooth(t * 1.6)).toFixed(3);
    heroCopy.style.transform = 'translate3d(0,' + (-t * 60).toFixed(1) + 'px,0)';
    heroLayers.forEach((l) => { const d = parseFloat(l.dataset.depth); l.style.transform = 'translate3d(0,' + (y * d).toFixed(1) + 'px,0)'; });
    villaStage.style.setProperty('--sc', (1 + t * 0.22).toFixed(4));
    villaStage.style.setProperty('--sy', (-y * 0.18).toFixed(1) + 'px');
    heroArt.style.opacity = (1 - smooth((t - 0.55) * 2.4)).toFixed(3);
    applyTilt();
  }
  function applyTilt() {
    villaStage.style.transform = 'translate3d(0,' + (villaStage.style.getPropertyValue('--sy') || '0px') + ',0) scale(' + (villaStage.style.getPropertyValue('--sc') || 1) + ') rotateX(' + (tiltY * -5).toFixed(2) + 'deg) rotateY(' + (tiltX * 7).toFixed(2) + 'deg)';
  }
  if (!reduce && fine) {
    hero.addEventListener('mousemove', (e) => { const r = hero.getBoundingClientRect(); mouseX = ((e.clientX - r.left) / r.width - 0.5) * 2; mouseY = ((e.clientY - r.top) / r.height - 0.5) * 2; });
    hero.addEventListener('mouseleave', () => { mouseX = 0; mouseY = 0; });
  }

  /* ---------- the loop: lerped scroll → chapters ---------- */
  const nav = $('#nav');
  let targetY = window.scrollY, y = targetY, running = false;
  window.addEventListener('scroll', () => { targetY = window.scrollY; kick(); }, { passive: true });
  window.addEventListener('resize', () => { kick(); });
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
  function frame() {
    const k = reduce ? 1 : fine ? 0.16 : 1;
    y = Math.abs(targetY - y) < 0.3 ? targetY : lerp(y, targetY, k);
    if (fine && !reduce) { tiltX = lerp(tiltX, mouseX, 0.06); tiltY = lerp(tiltY, mouseY, 0.06); }
    nav.classList.toggle('scrolled', y > 8);
    heroScrub(y);
    const vh = window.innerHeight;
    chapters.forEach((c) => {
      const top = c.el.offsetTop, h = c.el.offsetHeight - vh;
      const p = clamp((y - top) / Math.max(h, 1), 0, 1);
      // skip work when far off-screen and already settled at 0 or 1
      if ((p === 0 && c.last === 0) || (p === 1 && c.last === 1)) return;
      c.fn(p, c.el); c.last = p;
    });
    const settled = y === targetY && Math.abs(tiltX - mouseX) < 0.002 && Math.abs(tiltY - mouseY) < 0.002;
    if (settled) running = false; else requestAnimationFrame(frame);
  }
  kick();

  /* ---------- reveal (flow sections) ---------- */
  const revealEls = $$('.reveal, .reveal-scale');
  if (reduce || !('IntersectionObserver' in window)) revealEls.forEach((el) => el.classList.add('revealed'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- illustration slider (assumed constant rates, not a forecast) ---------- */
  const rate = $('#rate');
  const TREES = 6400000, VAULT = 3600000, VAULT_R = 0.065, SWP_Y = 360000, YEARS = 15;
  function vaultAt(t) { const g = Math.pow(1 + VAULT_R, t); return Math.max(0, VAULT * g - SWP_Y * (g - 1) / VAULT_R); }
  let illusShown = 0;
  function illustrate(animate) {
    const r = parseFloat(rate.value) / 100;
    rate.style.setProperty('--p', ((rate.value - rate.min) / (rate.max - rate.min) * 100) + '%');
    $('#rateLbl').textContent = rate.value + '%';
    const trees = TREES * Math.pow(1 + r, YEARS), vault = vaultAt(YEARS), total = trees + vault;
    $('#illusPaid').textContent = fmtShort(SWP_Y * YEARS); $('#illusVault').textContent = fmtShort(vault);
    const el = $('#illusTotal'), from = illusShown;
    if (reduce || !animate) el.textContent = '₹' + (total / 1e7).toFixed(2) + ' Cr';
    else { const t0 = performance.now(); (function tick(now) { const q = easeOut(clamp((now - t0) / 900, 0, 1)); el.textContent = '₹' + ((from + (total - from) * q) / 1e7).toFixed(2) + ' Cr'; if (q < 1) requestAnimationFrame(tick); })(t0); }
    illusShown = total;
    const yMax = TREES * Math.pow(1.14, YEARS) + VAULT, X = (t) => 20 + (t / YEARS) * 560, Y = (v) => 210 - (v / yMax) * 190;
    let d = '', dv = '';
    for (let t = 0; t <= YEARS; t++) { d += (t ? ' L' : 'M') + X(t).toFixed(1) + ',' + Y(TREES * Math.pow(1 + r, t)).toFixed(1); dv += (t ? ' L' : 'M') + X(t).toFixed(1) + ',' + Y(vaultAt(t)).toFixed(1); }
    $('#chartLine').setAttribute('d', d); $('#chartArea').setAttribute('d', d + ' L580,210 L20,210 Z'); $('#chartVault').setAttribute('d', dv);
    const dot = $('#chartDot'); dot.setAttribute('cx', X(YEARS)); dot.setAttribute('cy', Y(trees));
  }
  if (rate) { illustrate(false); rate.addEventListener('input', () => illustrate(true)); }

  /* ---------- risk bar ---------- */
  const riskBar = $('#riskBar');
  try { if (localStorage.getItem('dv-risk-ack') === '1') riskBar.classList.add('hide'); } catch (e) {}
  $('#riskClose').addEventListener('click', () => { riskBar.classList.add('hide'); try { localStorage.setItem('dv-risk-ack', '1'); } catch (e) {} });

  /* ---------- calculator ---------- */
  const parseNum = (s) => parseFloat(String(s).replace(/[^\d.]/g, '')) || 0;
  ['#price', '#rent', '#loan'].forEach((id) => { const i = $(id); i.addEventListener('blur', () => { const v = parseNum(i.value); i.value = v ? fmtINR(v) : ''; }); });
  $('#calc').addEventListener('submit', (e) => {
    e.preventDefault();
    const price = parseNum($('#price').value), rent = parseNum($('#rent').value), loan = parseNum($('#loan').value);
    if (!price || !rent) return;
    const keep = rent * 11 * 0.7 - loan * 0.085, yieldPct = (keep / price) * 100, entry = price * 0.14, swp = price * 0.36 / 120;
    $('#rFlat').textContent = '₹' + fmtINR(Math.round(keep));
    $('#rFlatNote').textContent = yieldPct.toFixed(2) + '% of price · ₹' + fmtINR(Math.round(entry)) + ' gone at entry';
    $('#rVilla').textContent = '₹' + fmtINR(Math.round(swp));
    $('#rVillaNote').textContent = '₹' + fmtINR(Math.round(swp * 12)) + ' a year · your own units · not assured';
    const res = $('#result'); res.hidden = false;
  });

  /* ---------- anchors ---------- */
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href'); const t = id.length > 1 && $(id); if (!t) return;
    e.preventDefault(); window.scrollTo({ top: t.offsetTop - (t.classList.contains('chapter') ? 0 : 48), behavior: reduce ? 'auto' : 'smooth' });
  }));
})();
