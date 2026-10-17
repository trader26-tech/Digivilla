import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=2a2bb696';
/* ── logic, verbatim from the design file ── */
const SLIDES = [
  ['assets/screens/home.webp', 'Home', 'Your estate, one glance', 'Value and this month’s rent on one screen.'],
  ['assets/screens/villa.webp', 'Villa detail', 'Inside every villa', 'What each villa holds, and what it pays.'],
  ['assets/screens/compare.webp', 'Compare', 'Compare anything', 'FD, flat or villa — same money, side by side.'],
  ['assets/screens/next.webp', 'Next villa', 'Next villa, dated', 'Your SIP tells you when the next one lands.'],
  ['assets/screens/fd.webp', 'FD vs DigiVilla', 'FD, side by side', 'What the bank pays vs what the city pays.'],
];
const INTERVAL = 3600, REST = 7000;          // ms per phone when playing by itself; pause after a touch
class Component extends DCLogic {
  state = { active: 0, near: false };
  railRef = React.createRef(); capRef = React.createRef(); counterRef = React.createRef(); rootRef = React.createRef(); dotsRef = React.createRef();
  /** place the five phones for `active`: the active one upright and bright, the neighbours turned away either side */
  layout(active) {
    const rail = this.railRef.current; if (!rail) return;
    [...rail.querySelectorAll('.msh-slide')].forEach((sl, i) => {
      const d = i - active, ad = Math.min(1.2, Math.abs(d));
      sl.style.transform = 'translate(calc(-50% + ' + (d * 80).toFixed(2) + '%), -50%) rotateY(' + (d * -24).toFixed(1) + 'deg) translateZ(' + (-ad * 160).toFixed(0) + 'px) scale(' + (1 - ad * .1).toFixed(3) + ')';
      sl.style.opacity = Math.max(0, Math.min(1, (2.1 - Math.abs(d)) / .6)).toFixed(3); sl.style.zIndex = Math.round(10 - ad * 5);
      const dim = sl.querySelector('.dim'); if (dim) dim.style.opacity = (ad * .55).toFixed(3);
    });
  }
  go(to, byUser) {
    const cap = this.capRef.current, cnt = this.counterRef.current, now = performance.now();
    this.cur = to; this.busy = true; this.slideAt = now; if (byUser) this.lastUser = now;
    this.layout(to);
    const dig = cnt && cnt.firstElementChild;
    if (cap) cap.style.opacity = 0; if (dig) dig.style.opacity = 0;
    clearTimeout(this.tCap); clearTimeout(this.tBusy);
    this.tCap = setTimeout(() => this.setState({ active: to }, () => { if (cap) cap.style.opacity = 1; if (dig) dig.style.opacity = 1; }), 180);
    this.tBusy = setTimeout(() => { this.busy = false; }, 600);
  }
  componentDidMount() {
    const root = this.rootRef.current, rail = this.railRef.current;
    this.cur = this.state.active; this.slideAt = performance.now(); this.lastUser = -1e9; this.visible = false; this.touching = false;
    if (root) {
      // the page pager asks the showcase first: a vertical swipe steps to the next / previous phone until the ends
      // (never gated on the slide animation: a step during one simply retargets it)
      // the phones move SIDEWAYS only (finger, autoplay, the bar); a vertical swipe / scroll always moves the page
      root.__step = () => false;
      root.__enter = dir => { if (dir > 0 && this.cur !== 0) { this.cur = 0; this.layout(0); this.setState({ active: 0 }); } this.slideAt = performance.now(); };
      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver(es => { this.visible = es[0].intersectionRatio >= .6; if (this.visible) this.slideAt = performance.now(); }, { threshold: [0, .6, 1] }); this.io.observe(root);
        // the four screens past the first load only once the showcase is within a screen of the viewport (measured
        // against the page's own scroller — `loading=lazy` can't see through the fixed scroller and fetched them at once)
        const scr = root.closest('[data-scroller]');
        this.near = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { this.near.disconnect(); this.setState({ near: true }); } }, { root: scr || null, rootMargin: '100% 0px' });
        this.near.observe(root);
      } else { this.visible = true; this.setState({ near: true }); }
    }
    if (rail) {
      // the phones follow the finger sideways (1:1 — one phone per 80% of the rail), with a little give at the ends;
      // on release they glide to the nearest phone, or the next one if the flick was quick
      let x0 = 0, y0 = 0, mode = null, lx = 0, lt = 0, base = 0, trail = [];   // trail: the finger's last positions, for the release speed
      const span = () => (rail.clientWidth || 300) * .8;
      rail.addEventListener('touchstart', e => { this.touching = true; mode = null; x0 = lx = e.touches[0].clientX; y0 = e.touches[0].clientY; lt = performance.now(); trail = [[lt, lx]]; base = this.cur; }, { passive: true });
      rail.addEventListener('touchmove', e => {
        const x = e.touches[0].clientX, dx = x - x0, dy = e.touches[0].clientY - y0, now = performance.now();
        if (!mode) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { mode = 'drag'; rail.classList.add('drag'); clearTimeout(this.tCap); } else if (Math.abs(dy) > 8) mode = 'page'; }
        if (mode !== 'drag') return;
        lx = x; lt = now; trail.push([now, x]); if (trail.length > 12) trail.shift();
        let f = base - dx / span();
        if (f < 0) f = -Math.min(.35, -f * .35); else if (f > SLIDES.length - 1) f = SLIDES.length - 1 + Math.min(.35, (f - SLIDES.length + 1) * .35);
        this.layout(f);
      }, { passive: true });
      const up = () => {
        this.touching = false; this.lastUser = performance.now();
        if (mode !== 'drag') return; mode = null; rail.classList.remove('drag');
        const moved = (x0 - lx) / span(), now = performance.now();
        // release speed = travel over the last ~150 ms up to the lift (a finger that stopped before lifting has little)
        const prior = trail.slice(0, -1), inWin = prior.filter(s => now - s[0] <= 150);
        const ref = inWin[0] || (prior.length && now - prior[prior.length - 1][0] <= 300 ? prior[prior.length - 1] : null);
        const v = ref && now > ref[0] ? (lx - ref[1]) / (now - ref[0]) : 0;
        let to = Math.round(base + moved);
        if (to === base && Math.abs(v) > .35) to = base + (v < 0 ? 1 : -1);
        to = Math.max(0, Math.min(SLIDES.length - 1, to));
        if (to !== this.cur) this.go(to, true); else this.layout(this.cur);
      };
      rail.addEventListener('touchend', up, { passive: true }); rail.addEventListener('touchcancel', up, { passive: true });
    }
    this.onResize = () => this.layout(this.state.active); addEventListener('resize', this.onResize);
    requestAnimationFrame(() => this.layout(this.state.active)); setTimeout(() => this.layout(this.state.active), 300);
    // the player: fills the active pill over INTERVAL, then slides to the next phone (round and round) — only while the
    // showcase is on screen, nobody is touching it, and the visitor hasn't stepped it by hand in the last REST ms
    const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = now => {
      const dots = this.dotsRef.current, on = dots && dots.querySelector('.on i');
      const playing = this.visible && !this.touching && !this.busy && !document.hidden && now - this.lastUser > REST && !rm;
      if (!playing) this.slideAt = now - (this.slideAt > now ? 0 : Math.min(now - this.slideAt, INTERVAL * .999));   // hold the fill where it is
      const u = Math.min(1, (now - this.slideAt) / INTERVAL);
      if (on) { const v = 'scaleX(' + u.toFixed(3) + ')'; if (on.__v !== v) { on.style.transform = v; on.__v = v; } }
      if (playing && u >= 1) this.go((this.cur + 1) % SLIDES.length, false);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  componentWillUnmount() { removeEventListener('resize', this.onResize); cancelAnimationFrame(this.raf); if (this.io) this.io.disconnect(); if (this.near) this.near.disconnect(); clearTimeout(this.tCap); clearTimeout(this.tBusy); }
  renderVals() {
    const a = this.state.active;
    return {
      railRef: this.railRef, capRef: this.capRef, counterRef: this.counterRef, rootRef: this.rootRef, dotsRef: this.dotsRef,
      slides: SLIDES.map(([src, alt], i) => ({ src: i === 0 || this.state.near ? src : null, alt })),
      cnum: String(a + 1).padStart(2, '0'), capTitle: SLIDES[a][2], capText: SLIDES[a][3],
      bars: SLIDES.map(([, alt], i) => ({ cls: 'msh-dot' + (i === a ? ' on' : i < a ? ' done' : ''), label: alt, pick: () => { if (i !== this.cur) this.go(i, true); } })),
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("section", {"ref": R(v," rootRef "), "id": "showcase", "class": "msh", "data-screen-label": "App showcase (phone)"}, h("div", {"class": "msh-grid"}), h("div", {"class": "msh-glowp"}), h("div", {"class": "msh-head"}, h("div", {"class": "msh-top"}, h("span", {"class": "msh-k"}, h("i", {}), "The DigiVilla app"), h("div", {"ref": R(v," counterRef "), "class": "msh-counter", "aria-live": "polite"}, h("span", {}, ...T(v,["", " cnum ", ""])), h("small", {}, "/ 05"))), h("h2", {}, h("span", {}, "Real estate,"), h("span", {"class": "g"}, "rebuilt as an app."))), h("div", {"ref": R(v," railRef "), "class": "msh-rail", "aria-label": "App screens"}, ...((L => Array.isArray(L) ? L : [])(R(v," slides ")).map((it, i) => (v => [h("div", {"class": "msh-slide"}, h("div", {"class": "msh-phone"}, h("div", {"class": "bezel"}, h("div", {"class": "screen"}, h("img", {"src": R(v," s.src "), "alt": R(v," s.alt "), "decoding": "async"}), h("div", {"class": "island"}), h("div", {"class": "sheen"}), h("div", {"class": "dim"})))))])({...v, "s": it, $index: i})))), h("div", {"class": "msh-foot"}, h("div", {"ref": R(v," capRef "), "class": "msh-cap"}, h("b", {}, ...T(v,["", " capTitle ", ""])), h("span", {}, ...T(v,["", " capText ", ""]))), h("div", {"class": "msh-bars"}, h("div", {"ref": R(v," dotsRef "), "class": "msh-dots", "role": "tablist", "aria-label": "App screens"}, ...((L => Array.isArray(L) ? L : [])(R(v," bars ")).map((it, i) => (v => [h("button", {"class": R(v," b.cls "), "onClick": R(v," b.pick "), "role": "tab", "aria-label": R(v," b.label "), "style": S("border:0;padding:0;cursor:pointer")}, h("i", {}))])({...v, "b": it, $index: i})))), h("span", {"aria-hidden": "true"}, h("svg", {"width": "15", "height": "10", "viewBox": "0 0 30 20", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M9 4L3 10l6 6M21 4l6 6-6 6M3 10h24"})), "Swipe"))))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n/* ── PAGE 2 · APP SHOWCASE (phones) — ported from mobile-site.html ──────────────────────────\n   A 100svh black page: kicker, \"Real estate, / rebuilt as an app.\", a serif 01/05 counter, a\n   rail of five phones in perspective (the centred one upright and bright, the neighbours turned\n   away and peeking in from the sides), the active phone's caption and an Apple-style page\n   progress bar. The rail plays by itself — every 3.6 s the next phone slides in from the right —\n   and rests for a while after the visitor touches it; the phones follow a sideways finger. A\n   vertical swipe always moves the page (the phones move sideways only). Dimming is an overlay, not a CSS filter. */\n.msh{position:relative;box-sizing:border-box;width:100%;max-width:100%;height:100vh;height:100svh;height:var(--pvh,100svh);background:#000;display:flex;flex-direction:column;color:#ececf1;overflow:hidden;font-family:Almarai,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;scroll-snap-align:start;scroll-snap-stop:always}\n.msh-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(rgba(233,233,237,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(233,233,237,.045) 1px,transparent 1px);background-size:36px 36px;-webkit-mask-image:radial-gradient(ellipse 60% 45% at 50% 50%,#000 20%,transparent 100%);mask-image:radial-gradient(ellipse 60% 45% at 50% 50%,#000 20%,transparent 100%)}\n.msh-glowp{position:absolute;left:50%;top:50%;width:120%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(closest-side,rgba(127,114,224,.22),rgba(127,114,224,.05) 50%,transparent)}\n.msh-head{position:relative;z-index:2;flex:none;padding:max(44px,env(safe-area-inset-top)) 24px 14px}\n.msh-top{display:flex;justify-content:space-between;align-items:center;gap:12px;height:28px}\n.msh-k{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#7a7c8c}\n.msh-k i{width:6px;height:6px;border-radius:50%;background:#8fd65a;box-shadow:0 0 10px #8fd65a}\n/* 36 px on every phone: the longer line is 269 px wide, inside the 272 px column of the narrowest (320 px) phone */\n.msh h2{margin:10px 0 0;font-size:36px;font-weight:800;line-height:1.04;letter-spacing:-.045em}\n.msh h2>span{display:block;white-space:nowrap}.msh h2>span.g{color:#7a7c8c}\n.msh-counter{flex:none;display:flex;align-items:baseline;gap:3px;font-family:'Instrument Serif',serif;font-style:italic;font-size:28px;line-height:1;color:#ececf1;font-variant-numeric:tabular-nums}\n.msh-counter>span{display:inline-block;min-width:1.05em;text-align:right;transition:opacity .2s,transform .3s cubic-bezier(.2,.8,.2,1)}\n.msh-counter small{margin-left:5px;font-family:Almarai,sans-serif;font-style:normal;font-size:11px;letter-spacing:.2em;color:#7a7c8c}\n.msh-rail{position:relative;z-index:2;flex:1;min-height:0;overflow:hidden;perspective:1200px;perspective-origin:50% 50%;touch-action:none}\n.msh-slide{position:absolute;left:50%;top:50%;width:72%;height:100%;transform:translate(-50%,-50%);display:grid;place-items:center;padding:14px 0;transition:transform .6s cubic-bezier(.2,.8,.2,1),opacity .45s;will-change:transform;transform-style:preserve-3d}\n.msh-rail.drag .msh-slide,.msh-rail.drag .msh-phone .dim{transition:none}\n.msh-phone{position:relative;height:100%;max-height:600px;max-width:100%;aspect-ratio:360/759}\n.msh-phone .dim{transition:opacity .6s}\n.msh-phone .bezel{position:absolute;inset:0;border-radius:15%/7%;padding:3.2%;background:linear-gradient(160deg,#a8aab1 0%,#3a3b41 10%,#141518 30%,#0a0a0c 60%,#2b2c31 85%,#8e9097 100%);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.26),inset 0 0 0 4px #050506,0 50px 90px -30px rgba(0,0,0,1),0 0 90px -20px rgba(127,114,224,.25)}\n.msh-phone .screen{position:relative;width:100%;height:100%;border-radius:13%/6%;overflow:hidden;background:#161826}\n.msh-phone .screen img{display:block;width:100%;height:100%;object-fit:cover}\n.msh-phone .island{position:absolute;left:50%;top:1.6%;width:30%;height:3.8%;transform:translateX(-50%);border-radius:999px;background:#000}\n.msh-phone .sheen{position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,255,255,.10),transparent 30%,transparent 70%,rgba(255,255,255,.04))}\n.msh-phone .dim{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}\n.msh-foot{position:relative;z-index:2;padding:0 24px max(22px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:18px}\n.msh-cap{display:flex;flex-direction:column;gap:6px;height:72px;transition:opacity .25s,transform .3s cubic-bezier(.2,.8,.2,1)}\n.msh-cap b{white-space:nowrap;font-size:24px;font-weight:800;letter-spacing:-.04em;color:#ececf1}.msh-cap>span{font-size:15px;line-height:1.4;color:#a3a5b4;text-wrap:pretty}\n.msh-bars{display:flex;align-items:center;gap:16px}\n.msh-dots{flex:1;display:flex;align-items:center;gap:6px;margin:0 -2px}\n.msh-dot{position:relative;flex:1;height:24px;margin:0;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent}\n.msh-dot::before,.msh-dot>i{content:\"\";position:absolute;left:2px;right:2px;top:50%;height:3px;margin-top:-1.5px;border-radius:2px}\n.msh-dot::before{background:rgba(236,236,241,.16);transition:background .3s}\n.msh-dot>i{background:#8fd65a;transform-origin:0 50%;transform:scaleX(0);transition:opacity .3s}\n.msh-dot.done>i{transform:scaleX(1);opacity:.5}\n.msh-dot.on::before{background:rgba(236,236,241,.24)}\n.msh-dot.on>i{opacity:1;box-shadow:0 0 8px rgba(143,214,90,.6)}\n.msh-bars>span{flex:none;display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#7a7c8c;white-space:nowrap}\n.msh-bars>span svg{opacity:.8}\n@media (prefers-reduced-motion:reduce){.msh-slide,.msh-dot>i,.msh-cap{transition:none}}\n"}];
export default defineDC("showcase-mobile", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
