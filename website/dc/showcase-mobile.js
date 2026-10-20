import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=92f3228d';
/* ── logic, verbatim from the design file ── */
const SLIDES = [
  ['assets/screens/home.webp', 'Home', 'Your estate, one glance', 'Value and this month’s rent on one screen.'],
  ['assets/screens/villa.webp', 'Villa detail', 'Inside every villa', 'What each villa holds, and what it pays.'],
  ['assets/screens/compare.webp', 'Compare', 'Compare anything', 'FD, flat or villa — same money, side by side.'],
  ['assets/screens/next.webp', 'Next villa', 'Next villa, dated', 'Your SIP tells you when the next one lands.'],
  ['assets/screens/fd.webp', 'FD vs DigiVilla', 'FD, side by side', 'What the bank pays vs what the city pays.'],
];
const N = SLIDES.length, INTERVAL = 4000, REST = 6000;   // ms per phone when it plays by itself; quiet time after any touch before it plays again
const K = 170, C = 2 * Math.sqrt(170);                    // the glide: a critically damped spring (settles in ~0.45 s, never overshoots)
/* ONE continuous position `pos` (0 … N−1, fractional mid-move) drives everything: the five phones, the caption, the counter
   and the progress bar. A finger / mouse / trackpad moves `pos` directly; letting go hands it to the spring with the
   release speed, aimed at the nearest phone or the next one if it was a flick. Grabbing it mid-glide continues from where
   it IS, never where it was heading. */
class Component extends DCLogic {
  state = { active: 0, near: false, capN: 0 };
  railRef = React.createRef(); capRef = React.createRef(); counterRef = React.createRef(); rootRef = React.createRef(); dotsRef = React.createRef();
  /** place the five phones for a (fractional) position: the active one upright and bright, the neighbours turned away */
  layout(p) {
    const rail = this.railRef.current; if (!rail) return;
    const sl = this.slideEls || (this.slideEls = [...rail.querySelectorAll('.msh-slide')]);
    sl.forEach((el, i) => {
      const d = i - p, ad = Math.min(1.2, Math.abs(d));
      el.style.transform = 'translate(calc(-50% + ' + (d * 80).toFixed(2) + '%), -50%) rotateY(' + (d * -24).toFixed(1) + 'deg) translateZ(' + (-ad * 160).toFixed(0) + 'px) scale(' + (1 - ad * .1).toFixed(3) + ')';
      el.style.opacity = Math.max(0, Math.min(1, (2.1 - Math.abs(d)) / .6)).toFixed(3); el.style.zIndex = Math.round(10 - ad * 5);
      const dim = el.__dim || (el.__dim = el.querySelector('.dim')); if (dim) dim.style.opacity = (ad * .55).toFixed(3);
    });
  }
  /** the progress bar: the pill nearest `pos` grows long (it slides between pills as the phones move); behind it, the pills
   *  already passed stay lit, and the active one fills while the showcase plays by itself (full while you're holding it) */
  bar(p, fillU) {
    const dots = this.dotEls && this.dotEls.length === N ? this.dotEls : (this.dotEls = this.dotsRef.current ? [...this.dotsRef.current.children] : []);
    const idx = Math.round(p);
    dots.forEach((el, i) => {
      const near = Math.max(0, 1 - Math.abs(i - p)), g = (1 + 2.2 * near).toFixed(3);
      if (el.__g !== g) { el.style.flexGrow = g; el.__g = g; }
      const f = i < idx ? 1 : i > idx ? 0 : fillU, o = i === idx ? 1 : .45;
      const fi = el.__i || (el.__i = el.firstElementChild); if (!fi) return;
      const sh = el.__f == null ? f : el.__f + (f - el.__f) * (Math.abs(f - el.__f) < .02 ? 1 : .28);   // eases jumps (1 → 0), tracks the timer
      el.__f = sh; const v = 'scaleX(' + sh.toFixed(3) + ')'; if (fi.__v !== v) { fi.style.transform = v; fi.__v = v; }
      const ov = String(o); if (fi.__o !== ov) { fi.style.opacity = ov; fi.__o = ov; }
    });
  }
  clamp(t) { return Math.max(0, Math.min(N - 1, t)); }
  /** aim the spring at phone `to` (from anywhere: a tap on the bar, a flick, the player) */
  go(to, byUser) { this.target = this.clamp(to); this.held = false; if (byUser) this.poke(); }
  /** any hand on it: the player rests, and starts the active pill from empty when it plays again */
  poke() { this.lastUser = performance.now(); this.slideAt = null; }
  /** the rubber band past either end */
  band(f) { return f < 0 ? -Math.min(.35, -f * .35) : f > N - 1 ? N - 1 + Math.min(.35, (f - N + 1) * .35) : f; }
  componentDidMount() {
    const root = this.rootRef.current, rail = this.railRef.current;
    this.pos = this.target = this.state.active; this.vel = 0; this.held = false; this.lastUser = -1e9; this.slideAt = null; this.visible = false; this.fade = null;
    if (root) {
      // the pagers ask the showcase first: a vertical swipe always moves the PAGE (the phones move sideways only)
      root.__step = () => false;
      root.__enter = dir => { if (dir > 0 && Math.round(this.pos) !== 0) { this.pos = this.target = 0; this.vel = 0; this.layout(0); } this.slideAt = null; };
      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver(es => { this.visible = es[0].intersectionRatio >= .6; }, { threshold: [0, .6, 1] }); this.io.observe(root);
        // the four screens past the first load only once the showcase is within a screen of the viewport (measured
        // against the page's own scroller — `loading=lazy` can't see through the fixed scroller and fetched them at once)
        const scr = root.closest('[data-scroller]');
        this.near = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { this.near.disconnect(); this.setState({ near: true }); } }, { root: scr || null, rootMargin: '100% 0px' });
        this.near.observe(root);
      } else { this.visible = true; this.setState({ near: true }); }
    }
    if (rail) {
      const span = () => (rail.clientWidth || 300) * .8;           // one phone = 80% of the rail
      // ── a finger (touch events) or a mouse / pen (pointer events): sideways = the phones, up/down = the page ──
      let x0 = 0, y0 = 0, mode = null, base = 0, trail = [];
      const start = (x, y) => { mode = null; x0 = x; y0 = y; base = this.pos; trail = [[performance.now(), x]]; this.poke(); };
      const move = (x, y) => {
        const dx = x - x0, dy = y - y0, now = performance.now();
        if (!mode) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { mode = 'drag'; this.held = true; this.vel = 0; rail.classList.add('drag'); } else if (Math.abs(dy) > 8) mode = 'page'; }
        if (mode !== 'drag') return false;
        trail.push([now, x]); if (trail.length > 12) trail.shift();
        this.pos = this.band(base - dx / span()); this.target = this.pos; this.poke();
        return true;
      };
      const end = () => {
        this.poke(); if (mode !== 'drag') { mode = null; return; } mode = null; rail.classList.remove('drag');
        // release speed over the last ~120 ms (a finger that stopped before lifting has none), in phones per second
        const now = performance.now(), prior = trail.filter(s => now - s[0] <= 120), a = prior[0], b = trail[trail.length - 1];
        const v = a && b[0] > a[0] && now - b[0] < 90 ? -(b[1] - a[1]) / (b[0] - a[0]) * 1000 / span() : 0;
        const from = Math.round(base), near = Math.round(this.pos);
        let to = near;
        if (to === from && Math.abs(v) > .9) to = from + Math.sign(v);           // a flick: one phone on, however short
        to = Math.max(from - 1, Math.min(from + 1, to));                          // never more than one phone per gesture
        this.held = false; this.vel = Math.max(-6, Math.min(6, v)); this.go(to, true);
      };
      rail.addEventListener('touchstart', e => { this.touching = true; start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
      rail.addEventListener('touchmove', e => { move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
      const tEnd = () => { this.touching = false; end(); };
      rail.addEventListener('touchend', tEnd, { passive: true }); rail.addEventListener('touchcancel', tEnd, { passive: true });
      rail.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' || e.button) return; this.mouse = e.pointerId; start(e.clientX, e.clientY); e.preventDefault(); });
      rail.addEventListener('pointermove', e => { if (this.mouse !== e.pointerId) return; if (move(e.clientX, e.clientY) && !rail.hasPointerCapture(e.pointerId)) { try { rail.setPointerCapture(e.pointerId); } catch (_) {} } });
      const pEnd = e => { if (this.mouse !== e.pointerId) return; this.mouse = null; end(); };
      rail.addEventListener('pointerup', pEnd); rail.addEventListener('pointercancel', pEnd);
      // ── a trackpad's sideways two-finger swipe (or shift+wheel): the phones follow, one phone per gesture, then settle ──
      let wBase = null, wT = 0;
      rail.addEventListener('wheel', e => {
        const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0); if (!dx || Math.abs(dx) < Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
        e.preventDefault(); const now = performance.now();
        if (wBase == null || now - wT > 220) wBase = Math.round(this.target);
        wT = now; this.poke(); this.held = true; this.vel = 0;
        const px = e.deltaMode === 1 ? dx * 16 : dx;
        this.pos = Math.max(wBase - 1, Math.min(wBase + 1, this.band(this.pos + px / span())));
        clearTimeout(this.wSettle);
        this.wSettle = setTimeout(() => { const d = this.pos - wBase; this.held = false; this.go(Math.abs(d) > .12 ? wBase + Math.sign(d) : wBase, true); wBase = null; }, 140);
      }, { passive: false });
      // ── keys, when the rail has focus ──
      rail.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); this.go(Math.round(this.target) + d, true); });
    }
    this.onResize = () => this.layout(this.pos); addEventListener('resize', this.onResize);
    // one loop: the spring, the player and the bar. Writes only what changed.
    const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now(), drawn = null;
    const tick = now => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!this.held) {
        if (rm) { this.pos = this.target; this.vel = 0; }
        else { const a = -K * (this.pos - this.target) - C * this.vel; this.vel += a * dt; this.pos += this.vel * dt; if (Math.abs(this.pos - this.target) < .0005 && Math.abs(this.vel) < .01) { this.pos = this.target; this.vel = 0; } }
      }
      // the player: fills the active pill over INTERVAL, then the next phone glides in; after the last, the rail fades back to the first
      const settled = !this.held && this.pos === this.target, playing = this.visible && !this.touching && this.mouse == null && settled && !document.hidden && now - this.lastUser > REST && !rm;
      if (playing && this.slideAt == null) this.slideAt = now;
      let u = playing ? Math.min(1, (now - this.slideAt) / INTERVAL) : (this.slideAt == null ? 1 : Math.min(1, (now - this.slideAt) / INTERVAL));
      if (!playing && this.slideAt != null) this.slideAt = now - u * INTERVAL;      // hold the fill where it is (hidden / scrolled away)
      if (playing && u >= 1) {
        this.slideAt = null;
        if (this.target < N - 1) this.go(this.target + 1, false);
        else if (!this.fade) { const rail = this.railRef.current; this.fade = now; if (rail) rail.style.opacity = 0; setTimeout(() => { this.pos = this.target = 0; this.vel = 0; this.layout(0); this.dotEls && this.dotEls.forEach(d => { d.__f = 0; }); if (rail) rail.style.opacity = 1; this.fade = null; }, 320); }
        u = 0;
      }
      if (drawn !== this.pos) { this.layout(this.pos); drawn = this.pos; }
      this.bar(this.pos, u);
      const idx = Math.max(0, Math.min(N - 1, Math.round(this.pos)));
      if (idx !== this.state.active) this.setState(s => ({ active: idx, capN: s.capN + 1 }));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  componentWillUnmount() { removeEventListener('resize', this.onResize); cancelAnimationFrame(this.raf); if (this.io) this.io.disconnect(); if (this.near) this.near.disconnect(); clearTimeout(this.wSettle); }
  renderVals() {
    const a = this.state.active, k = this.state.capN % 2;
    return {
      railRef: this.railRef, capRef: this.capRef, counterRef: this.counterRef, rootRef: this.rootRef, dotsRef: this.dotsRef,
      slides: SLIDES.map(([src, alt], i) => ({ src: i === 0 || this.state.near ? src : null, alt })),
      cnum: String(a + 1).padStart(2, '0'), capTitle: SLIDES[a][2], capText: SLIDES[a][3],
      capCls: 'msh-cap' + (this.state.capN ? ' swap' + k : ''), cntCls: 'msh-counter' + (this.state.capN ? ' swap' + k : ''),
      bars: SLIDES.map(([, alt], i) => ({ cls: 'msh-dot' + (i === a ? ' on' : ''), label: 'Show ' + alt, sel: i === a ? 'true' : 'false', pick: () => this.go(i, true) })),
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("section", {"ref": R(v," rootRef "), "id": "showcase", "class": "msh", "data-screen-label": "App showcase (phone)"}, h("div", {"class": "msh-grid"}), h("div", {"class": "msh-glowp"}), h("div", {"class": "msh-head"}, h("div", {"class": "msh-top"}, h("span", {"class": "msh-k"}, h("i", {}), "The DigiVilla app"), h("div", {"ref": R(v," counterRef "), "class": R(v," cntCls "), "aria-live": "polite"}, h("span", {}, ...T(v,["", " cnum ", ""])), h("small", {}, "/ 05"))), h("h2", {}, h("span", {}, "Real estate,"), h("span", {"class": "g"}, "rebuilt as an app."))), h("div", {"ref": R(v," railRef "), "class": "msh-rail", "tabindex": "0", "aria-roledescription": "carousel", "aria-label": "App screens — swipe or use the arrow keys"}, ...((L => Array.isArray(L) ? L : [])(R(v," slides ")).map((it, i) => (v => [h("div", {"class": "msh-slide"}, h("div", {"class": "msh-phone"}, h("div", {"class": "bezel"}, h("div", {"class": "screen"}, h("img", {"src": R(v," s.src "), "alt": R(v," s.alt "), "decoding": "async", "draggable": "false"}), h("div", {"class": "island"}), h("div", {"class": "sheen"}), h("div", {"class": "dim"})))))])({...v, "s": it, $index: i})))), h("div", {"class": "msh-foot"}, h("div", {"ref": R(v," capRef "), "class": R(v," capCls ")}, h("b", {}, ...T(v,["", " capTitle ", ""])), h("span", {}, ...T(v,["", " capText ", ""]))), h("div", {"class": "msh-bars"}, h("div", {"ref": R(v," dotsRef "), "class": "msh-dots", "role": "tablist", "aria-label": "App screens"}, ...((L => Array.isArray(L) ? L : [])(R(v," bars ")).map((it, i) => (v => [h("button", {"class": R(v," b.cls "), "onClick": R(v," b.pick "), "role": "tab", "aria-selected": R(v," b.sel "), "aria-label": R(v," b.label "), "style": S("border:0;padding:0;cursor:pointer")}, h("i", {}))])({...v, "b": it, $index: i})))), h("span", {"aria-hidden": "true"}, h("svg", {"width": "15", "height": "10", "viewBox": "0 0 30 20", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M9 4L3 10l6 6M21 4l6 6-6 6M3 10h24"})), "Swipe"))))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n/* ── PAGE 2 · APP SHOWCASE (phones) — ported from mobile-site.html ──────────────────────────\n   A 100svh black page: kicker, \"Real estate, / rebuilt as an app.\", a serif 01/05 counter, a\n   rail of five phones in perspective (the centred one upright and bright, the neighbours turned\n   away and peeking in from the sides), the active phone's caption and an Apple-style page\n   progress bar. One continuous position drives the phones, caption, counter and bar: a finger, a mouse\n   drag or a trackpad's sideways swipe moves it 1:1, letting go hands it to a spring (flick = next phone),\n   and the active pill slides between the bar's pills as you drag. It plays by itself (4 s a phone, the\n   active pill filling) and rests 6 s after any touch. A vertical swipe always moves the page (the phones\n   move sideways only). Dimming is an overlay, not a CSS filter. */\n.msh{position:relative;box-sizing:border-box;width:100%;max-width:100%;height:100vh;height:100svh;height:var(--pvh,100svh);background:#000;display:flex;flex-direction:column;color:#ececf1;overflow:hidden;font-family:Almarai,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;scroll-snap-align:start;scroll-snap-stop:always}\n.msh-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(rgba(233,233,237,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(233,233,237,.045) 1px,transparent 1px);background-size:36px 36px;-webkit-mask-image:radial-gradient(ellipse 60% 45% at 50% 50%,#000 20%,transparent 100%);mask-image:radial-gradient(ellipse 60% 45% at 50% 50%,#000 20%,transparent 100%)}\n.msh-glowp{position:absolute;left:50%;top:50%;width:120%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(closest-side,rgba(127,114,224,.22),rgba(127,114,224,.05) 50%,transparent)}\n.msh-head{position:relative;z-index:2;flex:none;padding:max(44px,env(safe-area-inset-top)) 24px 14px}\n.msh-top{display:flex;justify-content:space-between;align-items:center;gap:12px;height:28px}\n.msh-k{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#7a7c8c}\n.msh-k i{width:6px;height:6px;border-radius:50%;background:#8fd65a;box-shadow:0 0 10px #8fd65a}\n/* 36 px on every phone: the longer line is 269 px wide, inside the 272 px column of the narrowest (320 px) phone */\n.msh h2{margin:10px 0 0;font-size:36px;font-weight:800;line-height:1.04;letter-spacing:-.045em}\n.msh h2>span{display:block;white-space:nowrap}.msh h2>span.g{color:#7a7c8c}\n.msh-counter{flex:none;display:flex;align-items:baseline;gap:3px;font-family:'Instrument Serif',serif;font-style:italic;font-size:28px;line-height:1;color:#ececf1;font-variant-numeric:tabular-nums}\n.msh-counter>span{display:inline-block;min-width:1.05em;text-align:right}\n.msh-counter small{margin-left:5px;font-family:Almarai,sans-serif;font-style:normal;font-size:11px;letter-spacing:.2em;color:#7a7c8c}\n.msh-rail{position:relative;z-index:2;flex:1;min-height:0;overflow:hidden;perspective:1200px;perspective-origin:50% 50%;touch-action:none}\n.msh-slide{position:absolute;left:50%;top:50%;width:72%;height:100%;transform:translate(-50%,-50%);display:grid;place-items:center;padding:14px 0;will-change:transform;transform-style:preserve-3d;pointer-events:none}\n.msh-rail{transition:opacity .3s ease;cursor:grab;user-select:none;-webkit-user-select:none;outline:none}.msh-rail.drag{cursor:grabbing}\n.msh-phone{position:relative;height:100%;max-height:600px;max-width:100%;aspect-ratio:360/759}\n.msh-phone .bezel{position:absolute;inset:0;border-radius:15%/7%;padding:3.2%;background:linear-gradient(160deg,#a8aab1 0%,#3a3b41 10%,#141518 30%,#0a0a0c 60%,#2b2c31 85%,#8e9097 100%);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.26),inset 0 0 0 4px #050506,0 50px 90px -30px rgba(0,0,0,1),0 0 90px -20px rgba(127,114,224,.25)}\n.msh-phone .screen{position:relative;width:100%;height:100%;border-radius:13%/6%;overflow:hidden;background:#161826}\n.msh-phone .screen img{display:block;width:100%;height:100%;object-fit:cover}\n.msh-phone .island{position:absolute;left:50%;top:1.6%;width:30%;height:3.8%;transform:translateX(-50%);border-radius:999px;background:#000}\n.msh-phone .sheen{position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,255,255,.10),transparent 30%,transparent 70%,rgba(255,255,255,.04))}\n.msh-phone .dim{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}\n.msh-foot{position:relative;z-index:2;padding:0 24px max(22px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:18px}\n.msh-cap{display:flex;flex-direction:column;gap:6px;height:72px}\n.msh-cap.swap0,.msh-counter.swap0>span{animation:mshSwap0 .38s cubic-bezier(.2,.8,.2,1) both}.msh-cap.swap1,.msh-counter.swap1>span{animation:mshSwap1 .38s cubic-bezier(.2,.8,.2,1) both}\n@keyframes mshSwap0{from{opacity:0;transform:translateY(6px)}}@keyframes mshSwap1{from{opacity:0;transform:translateY(6px)}}\n.msh-cap b{white-space:nowrap;font-size:24px;font-weight:800;letter-spacing:-.04em;color:#ececf1}.msh-cap>span{font-size:15px;line-height:1.4;color:#a3a5b4;text-wrap:pretty}\n.msh-bars{display:flex;align-items:center;gap:16px}\n.msh-dots{flex:1;display:flex;align-items:center;gap:6px;margin:0 -2px}\n.msh-dot{position:relative;flex:1 1 0;min-width:0;height:28px;margin:0;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent}\n.msh-dot::before,.msh-dot>i{content:\"\";position:absolute;left:2px;right:2px;top:50%;height:3px;margin-top:-1.5px;border-radius:2px}\n.msh-dot::before{background:rgba(236,236,241,.16);transition:background .3s}\n.msh-dot>i{background:#8fd65a;transform-origin:0 50%;transform:scaleX(0);transition:opacity .3s}\n.msh-dot.on::before{background:rgba(236,236,241,.24)}\n.msh-dot.on>i{box-shadow:0 0 8px rgba(143,214,90,.6)}\n.msh-dot::before,.msh-dot>i{overflow:hidden}\n.msh-bars>span{flex:none;display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#7a7c8c;white-space:nowrap}\n.msh-bars>span svg{opacity:.8}\n@media (prefers-reduced-motion:reduce){.msh-dot>i,.msh-rail{transition:none}.msh-cap,.msh-counter>span{animation:none!important}}\n"}];
export default defineDC("showcase-mobile", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
