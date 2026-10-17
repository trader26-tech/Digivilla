import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=61559ef6';
import C_part_stage_foundation from './part-stage-foundation.js?v=61559ef6';
import C_part_stage_grading from './part-stage-grading.js?v=61559ef6';
import C_part_stage_plot from './part-stage-plot.js?v=61559ef6';
import C_part_stage_steel from './part-stage-steel.js?v=61559ef6';
import C_part_stage_villa from './part-stage-villa.js?v=61559ef6';
/* ── logic, verbatim from the design file ── */
import * as _explore from './explore-mobile.js?v=61559ef6';   // the Explore page's module, warmed with the landing
class Component extends DCLogic {
  state = { menuOpen: false };
  frameRef = React.createRef(); farRef = React.createRef(); nearRef = React.createRef(); frontRef = React.createRef(); glowRef = React.createRef();
  spineRef = React.createRef(); fillRef = React.createRef(); heroRef = React.createRef(); coinRef = React.createRef(); coin2Ref = React.createRef();
  copyARef = React.createRef(); copyBRef = React.createRef(); capRef = React.createRef(); pulseRef = React.createRef(); shineRef = React.createRef();
  holdLblRef = React.createRef(); knobRef = React.createRef(); ringRef = React.createRef(); arrowRef = React.createRef();
  t0 = React.createRef(); t1 = React.createRef(); t2 = React.createRef(); t3 = React.createRef(); t4 = React.createRef();

  makeClouds(W, H, seed, o) {
    const clamp = v => Math.max(0, Math.min(1, v));
    const P = new Uint8Array(512), p = [...Array(256).keys()];
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    const fade = t => t * t * (3 - 2 * t);
    const n2 = (x, y) => { const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y), h = (a, b) => P[P[a] + b] / 255, u = fade(xf), v = fade(yf), a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
    const fbm = (x, y) => { let t = 0, a = .5, f = 1; for (let k = 0; k < 5; k++) { t += a * n2(x * f, y * f); f *= 2.03; a *= .5; } return t; };
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), D = new Float32Array(W * (H + 2));
    for (let y = 0; y < H + 2; y++) { const v = y / H, depth = 1 / (v * o.persp + .12); for (let x = 0; x < W; x++) D[y * W + x] = fbm((x / W - .5) * depth * o.fx + 10, depth * o.fy); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = D[i], v = y / H;
      const a = clamp((d - (o.th - v * .08)) / .14) * Math.min(1, v * o.topFade);
      const lit = clamp((d - D[i + 2 * W]) * 9 + .55);
      const sun = Math.max(0, 1 - Math.hypot(x / W - o.sx, (v - o.sy) * 1.4) * 1.3);
      const k = Math.min(1, lit * (.55 + sun * .7)), sh = [84, 58, 112], li = [255, 216, 168];
      let r = sh[0] + (li[0] - sh[0]) * k, g = sh[1] + (li[1] - sh[1]) * k, b = sh[2] + (li[2] - sh[2]) * k;
      const hz = (1 - v) * o.haze; r += (226 - r) * hz; g += (140 - g) * hz; b += (96 - b) * hz;
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0); return cv;
  }

  scroller() {
    const r = this.props.scroller; if (r && r.current) return r.current;
    let el = this.frameRef.current; while (el && el !== document.body) { if (getComputedStyle(el).overflowY === 'auto') return el; el = el.parentElement; }
    return null;
  }

  componentDidMount() {
    this.setVH = () => { const sc = this.scroller(); if (sc && sc.clientHeight) { const v = sc.clientHeight + 'px'; if (sc.__vh !== v) { sc.style.setProperty('--pvh', v); sc.__vh = v; } } };
    this.setVH(); this.onDim = () => { this.dm = null; }; addEventListener('resize', this.onDim); addEventListener('resize', this.setVH); addEventListener('orientationchange', this.setVH);
    const paint = (ref, tex) => { const c = ref.current; if (!c) return; c.width = tex.width; c.height = tex.height; c.getContext('2d').drawImage(tex, 0, 0); };
    paint(this.farRef, this.makeClouds(240, 90, 7, { persp: 3, fx: 3.2, fy: 1.6, th: .5, topFade: 6, sx: .86, sy: 0, haze: .55 }));
    paint(this.nearRef, this.makeClouds(280, 150, 31, { persp: 1.6, fx: 2.8, fy: 1.5, th: .46, topFade: 5, sx: .9, sy: -.3, haze: .25 }));
    paint(this.frontRef, this.makeClouds(280, 130, 101, { persp: 1.2, fx: 2.3, fy: 1.3, th: .52, topFade: 4, sx: .95, sy: -.6, haze: .1 }));
    const clamp = v => Math.max(0, Math.min(1, v)), ease = t => -(Math.cos(Math.PI * t) - 1) / 2;
    // device tilt → parallax (silent where the browser needs a permission; a slow idle drift remains)
    let tx = 0, ty = 0; const sm = { x: 0, y: 0 };
    this.onTilt = e => { if (e.gamma == null) return; tx = clamp(e.gamma / 60 + .5) - .5; ty = clamp((e.beta - 45) / 80 + .5) - .5; };
    addEventListener('deviceorientation', this.onTilt);
    // swipe-up-to-explore: `hold` is the cascade (0 → 1 in .9 s) that lights the stages villa-first and fills the spine
    this.hold = 0; this.cascading = false; let litMin = 5, last = 0;
    this.startExplore = () => { if (this.leaving || this.cascading) return; this.cascading = true; this.prefetchExplore && this.prefetchExplore(); try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} };
    this.atColumn = () => {   // (kept for tests / callers; scrolling no longer explores)
      const sc = this.scroller(); if (!sc) return false; const tr = sc.querySelector('[data-hero-track]'); const R = tr ? tr.clientHeight - sc.clientHeight : 0; return Math.abs(sc.scrollTop - R) < 6 && (this.p || 0) > .96; };
    const SCRUB_VH = 1.6, CX = .5, CY = .37, COOLDOWN = 320;   // COOLDOWN: ms after a page arrives before the next swipe counts
    const SLOT = [[.22, .15], [.22, .31], [.22, .47], [.22, .63], [.22, .79]];
    // The finger drives the page. On the cover it scrubs the hero → column morph directly (half a screen of
    // finger = the whole morph, so one comfortable swipe crosses it); below, it moves the pages 1:1. When the
    // finger lifts, the page settles on the complete state in the direction it was last moving (any deliberate
    // move commits — a short swipe never bounces back), in at most 600 ms, and a new touch takes it over at
    // once. One touch moves at most one state: cover → column → the app showcase (its phones step first) →
    // the calculator → the footer, and back. Scrolling never leaves the page: the Explore lesson opens only
    // from a tap on the capsule (or the menu). Inner controls keep their own touches.
    {
      const sc0 = this.scroller();
      const rangeOf = () => { const tr = sc0 && sc0.querySelector('[data-hero-track]'); return tr ? tr.clientHeight - sc0.clientHeight : (sc0 ? sc0.clientHeight * SCRUB_VH : 1); };
      const easeOut = t => 1 - Math.pow(1 - t, 3);
      const offs = el => { let t = 0; for (let n = el; n && n !== sc0; n = n.offsetParent) t += n.offsetTop; return t; };
      const pages = () => {
        const R = rangeOf(), max = Math.max(0, sc0.scrollHeight - sc0.clientHeight);
        const list = [0, R];
        const app = document.getElementById('showcase'), calc = document.getElementById('calculator'), foot = document.querySelector('footer');
        if (app) list.push(offs(app)); if (calc) list.push(offs(calc)); if (foot) list.push(Math.min(max, offs(foot)));
        return list.filter((v, i, a) => i === 0 || v > a[i - 1] + 4);
      };
      const nearestIdx = (P, y) => { let k = 0; P.forEach((v, i) => { if (Math.abs(v - y) < Math.abs(P[k] - y)) k = i; }); return k; };
      this.restAt = 0; this.settling = false;
      // glide to a complete state: ease-out (it carries the finger's speed), ≤ 600 ms, cancelled by any touch
      this.settleTo = (to, dir) => {
        const sc = this.scroller(); if (!sc) return;
        cancelAnimationFrame(this.settleRaf);
        const from = sc.scrollTop, R = rangeOf(), dist = Math.abs(to - from);
        const show = document.querySelector('.msh');
        if (show && show.__enter && Math.abs(to - offs(show)) < 2 && Math.abs(from - to) > sc.clientHeight * .5) show.__enter(dir || (to > from ? 1 : -1));
        this.settleTarget = to;
        this.settleDirV = to > from ? 1 : to < from ? -1 : 0; if (this.settleDirV) this.lastDirV = this.settleDirV;
        const done = () => { sc.scrollTop = to; this.settling = false; this.restAt = performance.now(); if (Math.abs(to - R) < 2) this.prefetchExplore(); const q = this.pgQueue; this.pgQueue = 0; if (q) setTimeout(() => this.advance && this.advance(q), 0); };
        if (dist < 1 || reducedMotion) { done(); return; }
        const seg = Math.max(from, to) <= R + 1 ? R : sc.clientHeight;
        const D = seg === R ? Math.min(2300, 700 + 1600 * dist / Math.max(1, seg)) : Math.min(600, 200 + 400 * dist / Math.max(1, seg)), t0 = performance.now();   // the cover's build-up is a scene: unhurried
        this.settling = true;
        const step = now => {
          if (!this.settling) return;
          const u = Math.min(1, (now - t0) / D); sc.scrollTop = from + (to - from) * easeOut(u);
          if (u < 1) this.settleRaf = requestAnimationFrame(step); else done();
        };
        this.settleRaf = requestAnimationFrame(step);
      };
      this.goPage = (dir, quick) => {                                              // dir 0 = settle on the nearest page
        const sc = this.scroller(); if (!sc) return;
        const P = pages(), top = sc.scrollTop;
        let nxt = nearestIdx(P, top);
        if (dir > 0) { nxt = P.findIndex(v => v > top + 4); if (nxt < 0) nxt = P.length - 1; }
        else if (dir < 0) { nxt = -1; P.forEach((v, i) => { if (v < top - 4) nxt = i; }); if (nxt < 0) nxt = 0; }
        if (quick) { cancelAnimationFrame(this.settleRaf); this.settling = false; sc.scrollTop = P[nxt]; return; }
        this.settleTo(P[nxt], dir);
      };
      // the Explore page (and its pen font) is fetched only once the visitor heads for it
      this.prefetchExplore = () => {
        if (this.pf) return; this.pf = true;
        [['explore.html'], ['assets/fonts/Caveat-700-latin.woff2', 'font']].forEach(([href, as]) => {
          const l = document.createElement('link'); l.rel = 'prefetch'; l.href = href;
          if (as) { l.as = as; l.type = 'font/woff2'; l.crossOrigin = 'anonymous'; }
          document.head.appendChild(l);
        });
      };
      if (sc0) {
        let g = null;
        this.onTS2 = e => {
          g = null;
          const tg = e.target, c = (sel) => tg.closest ? tg.closest(sel) : null;
          if (this.state.menuOpen || this.leaving || c('.mfp-ruler') || c('.mcl-ruler') || c('.mcl-ystep') || c('.mcl-sheet') || c('select') || c('input') || c('textarea')) return;   // the calculator's ruler, years stepper, sheet and typing keep their own touches
          const now = performance.now(), wasSettling = this.settling;
          // ONE swipe = ONE page, however hard or fast: a flick that lands while the page is still gliding to its state
          // (or within a beat of arriving) is absorbed — the glide finishes where it was going and nothing is added
          if (wasSettling || now - (this.restAt || -1e9) < COOLDOWN) { g = { lock: true, y0: e.touches[0].clientY, x0: e.touches[0].clientX }; this.touchOn = true; return; }
          if (this.cascading && this.hold < 1) this.cascading = false;                       // …the explore cascade too
          const P = pages(), top = sc0.scrollTop, R = rangeOf();
          const ai = nearestIdx(P, wasSettling ? this.settleTarget : top);                 // the state this touch starts from
          let inner = c('.mcl'); if (inner && (Math.abs(top - offs(inner)) > 4 || !/auto|scroll/.test(getComputedStyle(inner).overflowY))) inner = null;   // only a page that really scrolls inside keeps the swipe
          const show = c('.msh'), t = e.touches[0];
          this.touchOn = true;
          g = { y0: t.clientY, x0: t.clientX, y: t.clientY, t: now, v: 0, dir: 0, P, R, ai, vh: sc0.clientHeight, inner, show, mode: null, moved: 0 };
          if (c('.mfp-capsule')) this.prefetchExplore();                                  // a finger on the capsule: the lesson is probably next
        };
        this.onTM2 = e => {
          if (!g) return;
          if (g.lock) {
            if (e.cancelable) e.preventDefault();
            const ly = g.y0 - e.touches[0].clientY, lx = g.x0 - e.touches[0].clientX, ldir = Math.sign(ly);
            // a swipe the OTHER way while the page is still gliding (or has just landed) = turn back, at once
            if (!g.turned && Math.abs(ly) > 30 && Math.abs(ly) > Math.abs(lx) && ldir && ldir !== (this.settling ? this.settleDirV : this.lastDirV)) { g.turned = true; this.advance(ldir); }
            return;
          }
          const t = e.touches[0], now = performance.now(), dy = g.y0 - t.clientY, dx = g.x0 - t.clientX;   // dy > 0: finger moved up = towards the next page
          if (!g.mode) {
            if (!dy && !dx) { if (e.cancelable) e.preventDefault(); return; }
            if (g.inner) {                                                              // the calculator scrolls its own content until an end
              const inr = g.inner, canDown = inr.scrollTop < inr.scrollHeight - inr.clientHeight - 8, canUp = inr.scrollTop > 8;
              if ((dy > 0 && canDown) || (dy < 0 && canUp)) { g = null; return; }
            }
            if (Math.abs(dx) > Math.abs(dy)) g.mode = 'side';                          // sideways: the phone rail steps itself; the page stays put
            else if (g.show && Math.abs(g.P[g.ai] - offs(g.show)) < 4 && Math.abs(sc0.scrollTop - offs(g.show)) < 4) g.mode = 'step';
            else g.mode = 'drag';
          }
          if (e.cancelable) e.preventDefault();
          const d = g.y - t.clientY, dtm = now - g.t;
          if (dtm > 0) g.v = g.v * .4 + .6 * (d / dtm);
          if (Math.abs(d) >= 1) g.dir = Math.sign(d);
          g.y = t.clientY; g.t = now; g.moved = Math.max(g.moved, Math.abs(dy));
          if (g.mode === 'side') return;
          if (g.mode === 'step') {                                                      // the showcase steps to its next phone first
            if (Math.abs(dy) > 36) {
              if (g.show.__step && g.show.__step(dy > 0 ? 1 : -1)) { g.mode = 'side'; return; }
              g.mode = 'drag'; g.y0 = t.clientY + (dy > 0 ? 36 : -36);                  // at an end: the page moves from here
            }
            return;
          }
          // drag: between the state this touch started from and its neighbours; the cover's morph is geared (half a
          // screen of finger = the whole morph), the pages below move 1:1
          const P = g.P, i = g.ai, R = g.R, cur = sc0.scrollTop;
          const lo = i > 0 ? P[i - 1] : P[0], hi = P[Math.min(P.length - 1, i + 1)];
          const gain = cur < R - .5 || (cur <= R + .5 && d < 0) ? R / (g.vh * .5) : 1;
          sc0.scrollTop = Math.max(lo, Math.min(hi, cur + d * gain));
        };
        this.onTE2 = () => {
          this.touchOn = false; this.lastUp = performance.now();
          const gg = g; g = null; if (!gg) { if (!this.settling && !this.leaving) this.goPage(0); return; }
          if (gg.lock) { if (!this.settling && !this.leaving) this.goPage(0); return; }
          const P = gg.P, i = gg.ai, top = sc0.scrollTop;
          const lo = i > 0 ? P[i - 1] : P[0], hi = P[Math.min(P.length - 1, i + 1)];
          const span = P.filter(v => v >= lo - .5 && v <= hi + .5);
          let to;
          if (gg.mode !== 'drag' || gg.moved < 10 || !gg.dir) to = P[i];                 // a tap (or a sideways swipe) keeps the state it started from
          else if (gg.dir > 0) { to = span.find(v => v >= top - .5); if (to == null) to = span[span.length - 1]; }
          else { to = span[0]; span.forEach(v => { if (v <= top + .5) to = v; }); }
          this.settleTo(to, gg.dir);
        };
        // safety net: if a touch the pager did not own (an inner control) still scrolled the page natively, land
        // on the nearest complete state once that scroll stops — the page never rests between states
        this.onSc2 = () => {
          if (this.touchOn || this.settling || this.leaving || performance.now() - (this.lastUp || -1e9) > 1500) return;
          clearTimeout(this.scT); this.scT = setTimeout(() => { if (!this.touchOn && !this.settling) this.goPage(0); }, 120);
        };
        sc0.addEventListener('scroll', this.onSc2, { passive: true });
        sc0.addEventListener('touchstart', this.onTS2, { passive: true });
        sc0.addEventListener('touchmove', this.onTM2, { passive: false });
        sc0.addEventListener('touchend', this.onTE2, { passive: true }); sc0.addEventListener('touchcancel', this.onTE2, { passive: true });
        // one step forward or back: on the app showcase its phones step first, then the page
        this.advance = dir => {
          if (this.leaving || this.state.menuOpen) return;
          const show = document.querySelector('.msh');
          if (show && show.__step && Math.abs(sc0.scrollTop - offs(show)) < 4 && show.__step(dir)) { this.restAt = performance.now(); return; }
          this.goPage(dir);
        };
        // Wheel and trackpad: a GESTURE moves one step. A trackpad swipe arrives as a burst of deltas plus a long
        // momentum tail that decays; the tail is swallowed. A new gesture = a pause (> 180 ms), or a delta that jumps
        // well above a decaying tail. Gestures that land while the page is gliding (or just after) are swallowed too.
        this.request = dir => {
          if (this.settling) { if (dir !== this.settleDirV) { this.pgQueue = 0; this.advance(dir); } else if (!this.pgQueue) this.pgQueue = dir; return; }
          this.advance(dir);
        };
        const gesture = pageGestures(dir => this.request(dir));
        this.onWheel2 = e => {
          const tg = e.target, c = sel => tg.closest ? tg.closest(sel) : null;
          if (c('.mcl-sheet') || c('.mfp-menu') || c('select')) return;                 // the calculator's walk-through scrolls itself
          let dy = e.deltaY, dx = e.deltaX;
          if (e.deltaMode === 1) { dy *= 16; dx *= 16; } else if (e.deltaMode === 2) { dy *= sc0.clientHeight; dx *= sc0.clientHeight; }
          if (Math.abs(dx) > Math.abs(dy) || !dy) return;                                 // sideways: the phone rail / the ruler
          e.preventDefault();
          gesture(e, dy);
        };
        sc0.addEventListener('wheel', this.onWheel2, { passive: false });
        this.onKey2 = e => {
          const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          const dir = { ArrowDown: 1, PageDown: 1, ' ': e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 }[e.key];
          if (!dir) return; e.preventDefault();
          if (e.repeat) return;
          this.request(dir);
        };
        addEventListener('keydown', this.onKey2);
        this.onVV = () => { this.setVH(); if (!g && !this.settling) this.goPage(0, true); };   // Safari's toolbars: re-measure, keep the page in place
        addEventListener('resize', this.onVV); if (window.visualViewport) visualViewport.addEventListener('resize', this.onVV);
      }
    }
    const tiles = [this.t0, this.t1, this.t2, this.t3, this.t4].map(r => r.current);
    const lbls = tiles.map(el => el && el.querySelector('.mfp-lbl'));
    const setT = (el, v) => { if (el && el.__v !== v) { el.style.transform = v; el.__v = v; } };
    const setO = (el, v) => { v = +(+v).toFixed(3); if (el && el.__o !== v) { el.style.opacity = v; el.__o = v; } };
    const tick = t => {
      const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; const k = t / 1000;
      this.hold = this.cascading ? Math.min(1, this.hold + dt / .35) : Math.max(0, this.hold - dt * (reducedMotion ? 99 : 1.6));
      sm.x += ((Math.sin(k * .23) * .12 + tx) - sm.x) * .05; sm.y += ((Math.cos(k * .19) * .08 + ty) - sm.y) * .05;
      const sc = this.scroller(), frame = this.frameRef.current;
      if (!frame) { this.raf = requestAnimationFrame(tick); return; }
      // sizes are read at the top of the frame and only every 32 frames (or after a resize) — a size read after
      // this frame's style writes would force a synchronous style + layout pass on every frame
      const fr = this.fr = (this.fr || 0) + 1;
      if ((fr & 31) === 0) { this.setVH(); this.dm = null; }
      if (!this.dm) { const hr = this.heroRef.current; this.dm = { W: frame.clientWidth, H: frame.clientHeight, ch: sc ? sc.clientHeight : 0, tw: tiles.map(el => el ? [el.offsetWidth, el.offsetHeight] : [0, 0]), hw: hr ? [hr.offsetWidth, hr.offsetHeight] : [0, 0] }; }
      const dm = this.dm;
      const raw = sc ? clamp(sc.scrollTop / Math.max(1, dm.ch * SCRUB_VH)) : 0;
      // the finger (or its settle) drives p directly — the morph is exactly where the finger is; other scrolling (wheel, keys, the menu's glide) gets a short time-based ease
      this.p = this.settling || reducedMotion || this.touchOn ? raw : (this.p || 0) + (raw - (this.p || 0)) * (1 - Math.exp(-dt * 14)); const p = this.p;
      const W = dm.W, H = dm.H;
      const onScreen = !sc || sc.scrollTop < dm.ch * 2.8;
      if (!onScreen) { this.raf = requestAnimationFrame(tick); return; }           // nothing to move once the frame has scrolled away
      setT(this.farRef.current, 'translate(' + (Math.sin(k * .05) * 10 - sm.x * 8).toFixed(1) + 'px,' + (p * 16).toFixed(1) + 'px)');
      setT(this.nearRef.current, 'translate(' + (Math.sin(k * .07 + 1) * 16 - sm.x * 18).toFixed(1) + 'px,' + (p * 30).toFixed(1) + 'px)');
      setT(this.frontRef.current, 'translate(' + (Math.sin(k * .09 + 2) * 22 - sm.x * 30).toFixed(1) + 'px,' + (p * 54).toFixed(1) + 'px)');
      const e = ease(clamp((p - .14) / .6)), hero0 = this.heroRef.current;
      if (this.hold < .01) litMin = 5;
      tiles.forEach((el, i) => {
        if (!el) return;
        const [w, hh] = dm.tw[i], [ex, ey] = SLOT[i];
        const ei = ease(clamp((p - .04 - (4 - i) * .07) / .38));          // staggered: 05 lands first (p≈.42), 01 last (p≈.70)
        let x, y, s, op;
        if (i === 4) { const s0 = (hero0 && w) ? dm.hw[0] / w : 2.1; x = CX + (ex - CX) * ei; y = CY + (ey - CY) * ei; s = s0 + (1 - s0) * ei; op = p > .05 ? 1 : 0; }
        else { x = CX + (ex - CX) * ei + Math.sin(ei * Math.PI) * .08; y = CY + (ey - CY) * ei; s = .55 + .45 * ei; op = clamp(ei * 2.2); }
        const bob = Math.sin(k * .8 + i * 1.3) * 4 * e + (i === 4 ? Math.sin(k * .7) * 5 * (1 - ei) : 0);
        setT(el, 'translate3d(' + (x * W - w / 2 - sm.x * (10 + i * 3) * e - (i === 4 ? sm.x * 20 * (1 - ei) : 0)).toFixed(1) + 'px,' + (y * H - hh / 2 + bob - sm.y * 6 * e - (i === 4 ? sm.y * 10 * (1 - ei) : 0)).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')');
        setO(el, op); if (!el.__z) { el.style.zIndex = i === 4 ? 3 : 2; el.__z = 1; }
        const on = this.hold > (4 - i) / 5 + .02;
        if (el.classList.contains('lit') !== on) el.classList.toggle('lit', on);
        if (on && i < litMin) { litMin = i; try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} }
        const l = lbls[i];
        if (l) { const lp = clamp((p - (.40 + (4 - i) * .07)) / .1); setO(l, lp); setT(l, 'translateY(-50%) translateX(' + ((1 - ease(lp)) * -12).toFixed(1) + 'px) scale(' + (1 / s).toFixed(4) + ')'); }
      });
      const hero = this.heroRef.current;
      if (hero) {
        // the hero is the villa until p = .05, then tile 05 (same art, same size, same spot) carries on — never two villas
        const vo = p > .05 ? 0 : 1;
        setT(hero, 'translate(' + (CX * W - dm.hw[0] / 2 - sm.x * 20).toFixed(1) + 'px,' + (CY * H - dm.hw[1] / 2 + (p > .05 ? 0 : Math.sin(k * .7) * 5) - sm.y * 10).toFixed(1) + 'px)');
        setO(hero, vo);
      }
      setT(this.coinRef.current, 'translateY(' + (Math.sin(k * 1.4) * 6).toFixed(1) + 'px) rotateY(' + ((k * 70) % 360).toFixed(1) + 'deg)');
      setT(this.coin2Ref.current, 'translateY(' + (Math.sin(k * 1.4) * 4).toFixed(1) + 'px) rotateY(' + ((k * 70) % 360).toFixed(1) + 'deg)'); setO(this.coin2Ref.current, clamp((p - .52) / .1));
      setO(this.glowRef.current, 1 - clamp(p / .5) * .6);
      const a = this.copyARef.current, oa = 1 - clamp(p / .18);
      if (a) { setO(a, oa); setT(a, 'translateY(' + (-p * 50).toFixed(1) + 'px)'); a.style.pointerEvents = oa < .1 ? 'none' : 'auto'; }
      const so = clamp((p - .45) / .32); setO(this.spineRef.current, so); setT(this.spineRef.current, 'scaleY(' + so.toFixed(4) + ')');
      const b = this.copyBRef.current, ob = clamp((p - .80) / .16), oc = clamp((p - .90) / .1);   // capsule last, then the caption
      if (b) {
        setO(b, p > .79 ? 1 : 0); b.style.pointerEvents = ob > .5 ? 'auto' : 'none';
        const capEl = this.capRef.current, cap2 = this.__capt || (this.__capt = b.querySelector('.mfp-caption'));
        if (capEl) { setO(capEl, ob); setT(capEl, 'translate3d(' + ((1 - ease(ob)) * 48).toFixed(1) + 'px,0,0)'); }
        if (cap2) { setO(cap2, oc); setT(cap2, 'translate3d(0,' + ((1 - ease(oc)) * 10).toFixed(1) + 'px,0)'); }
      }
      setO(this.pulseRef.current, .55 + .45 * Math.sin(k * 1.6));
      if (this.shineRef.current) this.shineRef.current.style.backgroundPosition = '0 ' + ((k * 18) % 150).toFixed(1) + '%';
      if (this.ringRef.current) this.ringRef.current.setAttribute('stroke-dashoffset', (219.9 * (1 - this.hold)).toFixed(1));
      setT(this.fillRef.current, 'scaleY(' + this.hold.toFixed(4) + ')');
      setT(this.knobRef.current, 'scale(' + (this.cascading ? .92 : 1) + ')');
      const hl = this.holdLblRef.current, txt = this.hold > .02 && this.hold < 1 ? Math.round(this.hold * 5) + ' / 5' : 'Tap to open';
      if (hl && hl.textContent !== txt) hl.textContent = txt;
      if (!this.cascading && !reducedMotion) { const ph = (k % 2.4) / 2.4, q = ph < .5 ? ph * 2 : 1; setT(this.arrowRef.current, 'translateX(' + (q < 1 ? Math.sin(q * Math.PI) * 5 : 0).toFixed(1) + 'px)'); }   // the arrow nudges INTO the capsule: it opens something
      if (this.hold >= 1 && !this.leaving) this.explore();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  componentWillUnmount() { if (this.onKey2) removeEventListener('keydown', this.onKey2); cancelAnimationFrame(this.raf); cancelAnimationFrame(this.settleRaf); this.settling = false; removeEventListener('deviceorientation', this.onTilt); removeEventListener('resize', this.setVH); removeEventListener('resize', this.onDim); removeEventListener('orientationchange', this.setVH); if (this.onVV) { removeEventListener('resize', this.onVV); window.visualViewport && visualViewport.removeEventListener('resize', this.onVV); } const sc = this.scroller(); if (sc && this.onTS2) { clearTimeout(this.scT); sc.removeEventListener('scroll', this.onSc2); sc.removeEventListener('touchstart', this.onTS2); if (this.onWheel2) sc.removeEventListener('wheel', this.onWheel2); sc.removeEventListener('touchmove', this.onTM2); sc.removeEventListener('touchend', this.onTE2); sc.removeEventListener('touchcancel', this.onTE2); } }
  explore() {
    if (this.leaving) return; this.leaving = true;
    const fr = this.frameRef.current;
    if (fr) { fr.style.transition = 'transform .3s cubic-bezier(.4,0,.2,1)'; fr.style.transformOrigin = '50% 60%'; fr.style.transform = 'scale(.97)'; }   // a small settle back as the night veil comes in
    const b = this.copyBRef.current; if (b) { b.style.transition = 'opacity .35s'; b.style.opacity = '0'; }
    try { localStorage.setItem('thedigiciti.chapter', '0'); } catch (_) {}
    if (window.tdcVeil) window.tdcVeil.go('explore.html', { style: 'night' }); else setTimeout(() => { location.href = 'explore.html'; }, 280);
  }
  glideTo(find) {
    return e => {
      e.preventDefault(); this.setState({ menuOpen: false });
      const sc = this.scroller(), el = find(); if (!sc || !el) return;
      let top = 0; for (let n = el; n && n !== sc; n = n.offsetParent) top += n.offsetTop;
      sc.scrollTo({ top, behavior: 'smooth' });
    };
  }
  renderVals() {
    const r = {};
    ['frameRef', 'farRef', 'nearRef', 'frontRef', 'glowRef', 'spineRef', 'fillRef', 'heroRef', 'coinRef', 'coin2Ref', 'copyARef', 'copyBRef', 'capRef', 'pulseRef', 'shineRef', 'holdLblRef', 'knobRef', 'ringRef', 'arrowRef', 't0', 't1', 't2', 't3', 't4'].forEach(n => r[n] = this[n]);
    r.menuOpen = this.state.menuOpen;
    r.openMenu = () => this.setState({ menuOpen: true }); r.closeMenu = () => this.setState({ menuOpen: false });
    r.goStory = e => { e.preventDefault(); this.setState({ menuOpen: false }); this.explore(); };
    r.goApp = this.glideTo(() => document.getElementById('showcase'));
    r.goCalc = this.glideTo(() => document.getElementById('calculator'));
    r.goContact = this.glideTo(() => document.querySelector('footer'));
    r.capClick = e => { e.preventDefault(); this.startExplore(); };     // a tap (or Enter) does what the swipe does
    return r;
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"class": "mfp"}, h("div", {"data-hero-track": "1", "class": "mfp-landing"}, h("div", {"class": "mfp-sticky"}, h("div", {"ref": R(v," frameRef "), "class": "mfp-frame"}, h("div", {"class": "mfp-halo"}), h("div", {"class": "mfp-sun"}), h("canvas", {"ref": R(v," farRef "), "class": "mfp-cloud mfp-far"}), h("canvas", {"ref": R(v," nearRef "), "class": "mfp-cloud mfp-near"}), h("div", {"ref": R(v," glowRef "), "class": "mfp-glow"}), h("div", {"ref": R(v," spineRef "), "class": "mfp-spine"}), h("div", {"ref": R(v," fillRef "), "class": "mfp-fill"}), h("div", {"ref": R(v," t0 "), "class": "mfp-tile"}, h("div", {"class": "mfp-tglow"}), h("div", {"class": "mfp-tshade"}), h("div", {"class": "mfp-lit"}), h("div", {"class": "mfp-art", "role": "img", "aria-label": "Plot"}, h(C_part_stage_plot, {"tile": "1"})), h("div", {"class": "mfp-lbl"}, h("span", {"class": "n"}, "01"), h("span", {"class": "t"}, "Plot"), h("span", {"class": "p"}, "₹1 L"))), h("div", {"ref": R(v," t1 "), "class": "mfp-tile"}, h("div", {"class": "mfp-tglow"}), h("div", {"class": "mfp-tshade"}), h("div", {"class": "mfp-lit"}), h("div", {"class": "mfp-art", "role": "img", "aria-label": "Land cleared"}, h(C_part_stage_grading, {"tile": "1"})), h("div", {"class": "mfp-lbl"}, h("span", {"class": "n"}, "02"), h("span", {"class": "t"}, "Land cleared"), h("span", {"class": "p"}, "₹2 L"))), h("div", {"ref": R(v," t2 "), "class": "mfp-tile"}, h("div", {"class": "mfp-tglow"}), h("div", {"class": "mfp-tshade"}), h("div", {"class": "mfp-lit"}), h("div", {"class": "mfp-art", "role": "img", "aria-label": "Foundation"}, h(C_part_stage_foundation, {"tile": "1"})), h("div", {"class": "mfp-lbl"}, h("span", {"class": "n"}, "03"), h("span", {"class": "t"}, "Foundation"), h("span", {"class": "p"}, "₹3 L"))), h("div", {"ref": R(v," t3 "), "class": "mfp-tile"}, h("div", {"class": "mfp-tglow"}), h("div", {"class": "mfp-tshade"}), h("div", {"class": "mfp-lit"}), h("div", {"class": "mfp-art", "role": "img", "aria-label": "Steel frame"}, h(C_part_stage_steel, {"tile": "1"})), h("div", {"class": "mfp-lbl"}, h("span", {"class": "n"}, "04"), h("span", {"class": "t"}, "Steel frame"), h("span", {"class": "p"}, "₹4 L"))), h("div", {"ref": R(v," t4 "), "class": "mfp-tile villa"}, h("div", {"class": "mfp-tglow"}), h("div", {"class": "mfp-tshade"}), h("div", {"class": "mfp-lit"}), h("div", {"class": "mfp-art", "role": "img", "aria-label": "Villa"}, h(C_part_stage_villa, {"tile": "1"})), h("div", {"class": "mfp-lbl"}, h("span", {"class": "n"}, "05"), h("span", {"class": "t"}, "Villa"), h("span", {"class": "p"}, "₹5 L · pays rent")), h("img", {"ref": R(v," coin2Ref "), "class": "mfp-coin", "src": "assets/art/coin.svg", "alt": "", "decoding": "async"})), h("div", {"ref": R(v," heroRef "), "class": "mfp-hero"}, h("div", {"class": "mfp-hglow"}), h("div", {"class": "mfp-tshade"}), h("div", {"class": "mfp-art", "role": "img", "aria-label": "A finished DigiVilla"}, h(C_part_stage_villa, {"tile": "1"})), h("img", {"ref": R(v," coinRef "), "class": "mfp-coin", "src": "assets/art/coin.svg", "alt": "", "decoding": "async"})), h("canvas", {"ref": R(v," frontRef "), "class": "mfp-cloud mfp-front"}), h("div", {"class": "mfp-grain"}), h("div", {"class": "mfp-vignette"}), h("nav", {"class": "mfp-nav", "aria-label": "Main"}, h("span", {"class": "wordmark"}, "TheDigiCiti"), h("button", {"onClick": R(v," openMenu "), "aria-label": "Open menu"}, h("svg", {"viewBox": "0 0 24 24", "width": "20", "height": "20", "fill": "none", "stroke": "currentColor", "stroke-width": "1.6", "stroke-linecap": "round"}, h("path", {"d": "M5 9h14M5 15h9"})))), (R(v," menuOpen ") ? [h("div", {"class": "mfp-menu", "role": "dialog", "aria-label": "Menu"}, h("header", {}, h("span", {}, "Menu"), h("button", {"onClick": R(v," closeMenu "), "aria-label": "Close menu"}, h("svg", {"viewBox": "0 0 24 24", "width": "18", "height": "18", "fill": "none", "stroke": "currentColor", "stroke-width": "1.8", "stroke-linecap": "round"}, h("path", {"d": "M6 6l12 12M18 6L6 18"})))), h("div", {"class": "links"}, h("a", {"href": "explore.html", "onClick": R(v," goStory ")}, "Our story"), h("a", {"href": "#showcase", "onClick": R(v," goApp ")}, "The app"), h("a", {"href": "#calculator", "onClick": R(v," goCalc ")}, "Calculator"), h("a", {"href": "#contact", "class": "dim", "onClick": R(v," goContact ")}, "Contact")), h("p", {}, "A villa in India that pays you rent. ", h("span", {"class": "serif"}, "Built by your SIP.")))] : null), h("div", {"ref": R(v," copyARef "), "class": "mfp-copyA"}, h("h1", {}, h("span", {"class": "row"}, h("span", {"data-rise": "0"}, "The"), h("span", {"data-rise": "1"}, "Digi")), h("span", {"data-rise": "2"}, "Citi")), h("div", {"class": "foot"}, h("p", {"data-rise": "3"}, "A villa in India that pays you rent. ", h("span", {"class": "serif"}, "Built by your SIP,"), " wherever you live."), h("span", {"class": "hint", "data-rise": "4"}, h("svg", {"viewBox": "0 0 24 24", "width": "16", "height": "16", "fill": "none", "stroke": "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"}, h("path", {"d": "M12 19V5M6 11l6-6 6 6"})), h("i", {}), "Swipe up"))), h("div", {"ref": R(v," copyBRef "), "class": "mfp-copyB"}, h("a", {"ref": R(v," capRef "), "class": "mfp-capsule", "href": "explore.html", "onClick": R(v," capClick "), "aria-label": "Explore: return and risk, then the calculator"}, h("span", {"ref": R(v," pulseRef "), "class": "mfp-pulse"}), h("span", {"class": "top"}, h("span", {"class": "dot"}), h("span", {"class": "kicker vert"}, "The NRI story")), h("span", {"ref": R(v," shineRef "), "class": "mfp-shine vert"}, "Explore"), h("span", {"class": "bottom"}, h("span", {"ref": R(v," holdLblRef "), "class": "mfp-holdLbl"}, "Tap to open"), h("span", {"ref": R(v," knobRef "), "class": "mfp-knob"}, h("svg", {"class": "ring", "viewBox": "0 0 76 76", "width": "76", "height": "76"}, h("circle", {"cx": "38", "cy": "38", "r": "35", "fill": "none", "stroke": "rgba(255,236,205,.22)", "stroke-width": "2"}), h("circle", {"ref": R(v," ringRef "), "cx": "38", "cy": "38", "r": "35", "fill": "none", "stroke": "#fbdb81", "stroke-width": "3", "stroke-linecap": "round", "stroke-dasharray": "219.9", "stroke-dashoffset": "219.9"})), h("span", {"class": "btn"}, h("svg", {"ref": R(v," arrowRef "), "viewBox": "0 0 24 24", "width": "24", "height": "24", "fill": "none", "stroke": "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"}, h("path", {"d": "M5 12h14M13 6l6 6-6 6"})))))), h("span", {"class": "mfp-caption"}, h("span", {}, "Every villa, ", h("span", {"class": "serif"}, "five stages"), " in the making."), h("span", {"class": "more", "aria-hidden": "true"}, h("svg", {"viewBox": "0 0 24 24", "width": "14", "height": "14", "fill": "none", "stroke": "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M12 19V5M6 11l6-6 6 6"})), "Swipe up for the app"))))), h("div", {"class": "mfp-coverEnd"})))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n/* ── TheDigiCiti · MOBILE FRONT PAGE (ported from mobile-front-page.html) ───────────────────────\n   One pinned dusk-sky frame scrubbed by 160svh of scroll (p 0→1): the hero villa shrinks into the\n   bottom slot of a vertical column of five build-stage tiles on the left, labels to their right,\n   a gold spine joining them, and a tall glass capsule on the right — \"THE NRI STORY · Explore ·\n   TAP TO OPEN\". The finger scrubs the morph directly and the page rests only in complete states,\n   one per swipe: cover → the column (settles in ≤ .6 s when the finger lifts) → the app → the\n   calculator → the footer, like any page. The capsule is a button: a tap lights the five stages\n   villa-first, the gold fill climbs the spine and the page leaves for the Explore lesson. Art = the app's own stage tiles\n   (vector), glows are gradients (no CSS filters on anything that moves). */\n.mfp{position:relative;max-width:480px;margin:0 auto;font-family:Almarai,-apple-system,'Segoe UI',sans-serif;color:#E1E0CC;-webkit-tap-highlight-color:transparent}\n.mfp a{color:#E1E0CC;text-decoration:none}\n.mfp .serif{font-family:'Instrument Serif',serif;font-style:italic}\n.mfp-landing{position:relative;height:260vh;height:260svh;height:calc(var(--pvh,100svh) * 2.6)}\n.mfp-coverEnd{position:absolute;left:0;right:0;bottom:0;height:100vh;height:100svh;height:var(--pvh,100svh);pointer-events:none}\n.mfp-sticky{position:sticky;top:0;box-sizing:border-box;height:100vh;height:100svh;height:var(--pvh,100svh);padding:10px}\n.mfp-frame{position:relative;width:100%;height:100%;border-radius:22px;overflow:hidden;background:linear-gradient(180deg,#0c0f2c 0%,#1d1d4a 14%,#2a2862 26%,#73467c 42%,#b8606a 52%,#d9814f 62%,#f3bd7c 73%,#a8606a 88%,#3a2a52 100%)}\n.mfp-halo{position:absolute;right:10%;top:22%;width:120%;aspect-ratio:1;transform:translate(50%,-50%);border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(255,222,170,.75),rgba(240,138,74,.32) 38%,rgba(217,129,79,0) 70%)}\n.mfp-sun{position:absolute;right:10%;top:22%;width:12%;aspect-ratio:1;transform:translate(50%,-50%);border-radius:50%;background:radial-gradient(circle,#fff5d6 0%,#ffd38a 55%,rgba(240,138,74,0) 100%)}\n.mfp-cloud{position:absolute;pointer-events:none;will-change:transform}\n.mfp-far{left:-10%;top:32%;width:120%;height:30%;opacity:.9}\n.mfp-near{left:-12%;top:44%;width:124%;height:46%}\n.mfp-front{left:-14%;top:64%;width:128%;height:40%;opacity:.95}\n.mfp-glow{position:absolute;left:50%;top:40%;width:150%;aspect-ratio:1.6;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(255,214,150,.5),rgba(255,190,120,.14) 50%,transparent)}\n.mfp-spine{position:absolute;left:22%;top:15%;height:64%;width:1px;transform-origin:50% 0;transform:scaleY(0);opacity:0;pointer-events:none;background:linear-gradient(180deg,rgba(255,226,170,0),rgba(255,226,170,.55) 12%,rgba(255,226,170,.55) 88%,rgba(251,219,129,.9))}\n.mfp-fill{position:absolute;left:calc(22% - 1px);top:15%;height:64%;width:3px;border-radius:2px;transform-origin:50% 100%;transform:scaleY(0);pointer-events:none;z-index:1;background:linear-gradient(180deg,#fffaf0,#fbdb81 40%,#f6c445);box-shadow:0 0 12px rgba(251,219,129,.9)}\n.mfp-tile{position:absolute;left:0;top:0;width:37%;width:min(37%,14.5svh);opacity:0;will-change:transform,opacity}\n.mfp-art{position:relative;width:100%;aspect-ratio:820/700}\n.mfp-art>div{display:block;width:100%;height:100%}\n.mfp-tglow{position:absolute;left:-18%;top:-14%;width:136%;height:128%;border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(255,196,130,.30),rgba(255,190,120,.10) 50%,transparent 72%)}\n.mfp-tshade{position:absolute;left:-4%;top:58%;width:108%;height:54%;border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(18,12,28,.5),rgba(18,12,28,.16) 55%,transparent 75%)}\n.mfp-lit{position:absolute;left:-26%;top:-24%;width:152%;height:150%;border-radius:50%;pointer-events:none;opacity:0;transition:opacity .35s;background:radial-gradient(closest-side,rgba(251,219,129,.6),rgba(246,196,69,.28) 50%,transparent 74%)}\n.mfp-tile.lit .mfp-lit{opacity:1}\n.mfp-lbl{position:absolute;left:100%;top:50%;margin-left:14px;transform:translateY(-50%);transform-origin:0 50%;opacity:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px;white-space:nowrap}\n.mfp-lbl .n{font-size:11px;letter-spacing:.22em;color:rgba(225,224,204,.7)}\n.mfp-lbl .t{font-size:13px;color:#E1E0CC}\n.mfp-lbl .p{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;color:rgba(225,224,204,.8)}\n.mfp-tile.villa .mfp-lbl .n,.mfp-tile.villa .mfp-lbl .p{color:#fbdb81}.mfp-tile.villa .mfp-lbl .t{color:#fff}\n.mfp-coin{position:absolute;left:45%;top:-6%;width:11%;opacity:0}\n.mfp-hero{position:absolute;left:0;top:0;width:82%;width:min(82%,42svh);aspect-ratio:820/700;z-index:3;will-change:transform,opacity}\n.mfp-hero .mfp-coin{left:45.5%;top:-2%;width:9%;opacity:1}\n.mfp-hglow{position:absolute;left:-16%;top:-12%;width:132%;height:124%;border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(255,196,130,.32),rgba(255,190,120,.10) 50%,transparent 72%)}\n.mfp-grain{position:absolute;inset:0;pointer-events:none;opacity:.6;mix-blend-mode:overlay;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E\")}\n.mfp-vignette{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.32) 0%,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 50%,rgba(0,0,0,.7) 100%)}\n.mfp-nav{position:absolute;left:50%;top:0;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:18px;padding:6px 6px 6px 18px;border-radius:0 0 18px 18px;background:#000;white-space:nowrap}\n.mfp-nav .wordmark{font-size:14px;font-weight:700;letter-spacing:-.02em}\n.mfp-nav button{width:44px;height:44px;border:0;border-radius:14px;background:#14131a;color:#E1E0CC;display:grid;place-items:center;cursor:pointer;padding:0;font:inherit}\n.mfp-menu{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;padding:24px 24px 32px;background:rgba(6,6,14,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}\n.mfp-menu header{display:flex;justify-content:space-between;align-items:center}\n.mfp-menu header>span{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:rgba(255,226,170,.9)}\n.mfp-menu header button{width:44px;height:44px;border:0;border-radius:50%;background:#E1E0CC;color:#000;display:grid;place-items:center;cursor:pointer;padding:0;font:inherit}\n.mfp-menu .links{flex:1;display:flex;flex-direction:column;justify-content:center;gap:8px}\n.mfp-menu .links a{font-size:44px;letter-spacing:-.05em;line-height:1.15;background:none;border:0;padding:0;text-align:left;font:inherit;font-size:44px;color:#E1E0CC;cursor:pointer}\n.mfp-menu .links a.dim{color:rgba(225,224,204,.55)}\n.mfp-menu p{margin:0;font-size:14px;line-height:1.5;color:rgba(222,219,200,.7)}.mfp-menu p .serif{font-size:1.15em;color:#E1E0CC}\n.mfp-copyA{position:absolute;left:0;right:0;bottom:0;z-index:4;display:flex;flex-direction:column;gap:16px;padding:0 20px 24px}\n.mfp-copyA h1{margin:0;display:flex;flex-direction:column;font-size:clamp(52px,23vw,118px);font-size:clamp(52px,min(23vw,11svh),118px);font-weight:400;line-height:.84;letter-spacing:-.07em}\n.mfp-copyA h1 .row{display:flex}\n.mfp-copyA .foot{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}\n.mfp-copyA p{margin:0;max-width:230px;font-size:15px;line-height:1.3;color:rgba(222,219,200,.75);text-wrap:pretty}.mfp-copyA p .serif{font-size:1.2em;color:#E1E0CC}\n.mfp-copyA .hint{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:rgba(225,224,204,.75)}\n.mfp-copyA .hint i{width:1px;height:26px;background:linear-gradient(#E1E0CC,rgba(225,224,204,0))}\n.mfp-copyA .hint svg{margin-bottom:-4px}\n.mfp [data-rise]{display:inline-block;transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}\n.mfp-copyB{position:absolute;inset:0;z-index:4;opacity:0;pointer-events:none}\n.mfp-capsule{position:absolute;right:4.5%;top:13%;bottom:13%;width:24%;max-width:104px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:22px 0 10px;border-radius:999px;color:#E1E0CC;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;background:linear-gradient(180deg,rgba(255,236,205,.16),rgba(255,214,160,.06) 55%,rgba(255,236,205,.14));box-shadow:inset 0 0 0 1px rgba(255,236,205,.32),inset 0 1px 0 rgba(255,255,255,.25),0 30px 60px -20px rgba(20,10,30,.6);backdrop-filter:blur(10px) saturate(1.2);-webkit-backdrop-filter:blur(10px) saturate(1.2)}\n.mfp-pulse{position:absolute;left:50%;top:50%;width:220%;height:90%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;z-index:-1;background:radial-gradient(closest-side,rgba(255,210,150,.35),rgba(255,190,120,.08) 60%,transparent)}\n.mfp .vert{writing-mode:vertical-rl;transform:rotate(180deg)}\n.mfp-capsule .top{display:flex;flex-direction:column;align-items:center;gap:10px}\n.mfp-capsule .dot{width:5px;height:5px;border-radius:50%;background:#fbdb81;box-shadow:0 0 10px #fbdb81}\n.mfp-capsule .kicker{font-size:11px;font-weight:700;letter-spacing:.32em;text-transform:uppercase;color:rgba(255,226,170,.95)}\n.mfp-shine{font-size:clamp(50px,17vw,80px);font-size:clamp(50px,min(17vw,8.5svh),80px);font-weight:400;line-height:.9;letter-spacing:-.05em;padding:.08em 0;color:transparent;background:linear-gradient(90deg,#cdb894 0%,#E1E0CC 35%,#fffaf0 50%,#E1E0CC 65%,#cdb894 100%);background-size:100% 300%;-webkit-background-clip:text;background-clip:text}\n.mfp-capsule .bottom{display:flex;flex-direction:column;align-items:center;gap:8px}\n.mfp-holdLbl{max-width:80px;font-size:11px;font-weight:700;line-height:1.45;letter-spacing:.24em;text-align:center;text-transform:uppercase;color:rgba(255,226,170,.95)}\n.mfp-knob{position:relative;flex:none;width:76px;height:76px;display:grid;place-items:center;transition:transform .35s cubic-bezier(.2,.8,.2,1)}\n.mfp-knob svg.ring{position:absolute;inset:0;transform:rotate(-90deg);overflow:visible}\n.mfp-knob .btn{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;background:#E1E0CC;color:#000;box-shadow:0 0 0 1px rgba(255,236,200,.8),0 0 36px rgba(255,214,150,.6),0 14px 26px -10px rgba(0,0,0,.6)}\n.mfp-caption{position:absolute;left:6.5%;right:34%;bottom:3.5%;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.4;color:rgba(225,224,204,.75)}\n.mfp-caption .more{display:flex;white-space:nowrap;align-items:center;gap:8px;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:rgba(225,224,204,.6)}.mfp-caption .serif{font-size:1.15em;color:#E1E0CC}\n@media (prefers-reduced-motion:reduce){.mfp [data-rise],.mfp-knob{transition:none}}\n/* short phones (SE, small Androids, Safari with its bars): a smaller knob and word so the capsule holds them, and the column's caption gives way to the scroll hint */\n@media (max-height:700px){.mfp-knob,.mfp-knob svg.ring{width:58px;height:58px}.mfp-knob .btn{width:46px;height:46px}.mfp-shine{font-size:clamp(42px,min(15vw,6.8svh),70px)}.mfp-capsule .top{gap:8px}.mfp-caption>span:first-child{display:none}}\n"}];
export default defineDC("landing-mobile", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
