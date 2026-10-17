import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=1bb3bce2';
import C_story_1_journey from './story-1-journey.js?v=1bb3bce2';
import C_story_2_map from './story-2-map.js?v=1bb3bce2';
import C_story_3_numbers from './story-3-numbers.js?v=1bb3bce2';
addCSS(".p-story-1:hover{gap:16px !important;color:#fff !important;box-shadow:inset 0 0 0 1px rgba(255,236,200,.5), inset 0 1px 0 rgba(255,255,255,.2), 0 0 34px rgba(255,200,130,.25), 0 10px 30px -12px rgba(0,0,0,.7) !important}");
/* ── logic, verbatim from the design file ── */
// Laptops start the story at "Reading the map" — the flight (chapter 0) is a phone-only opening.
// Chapters keep their indices (0 flight · 1 map · 2 numbers); FIRST is where this screen's story begins.
const FIRST = typeof innerWidth === 'number' && innerWidth > 700 ? 1 : 0;
class Component extends DCLogic {
  // Explore sets localStorage['thedigiciti.chapter'] = '0'; a nav link can ask for a chapter with #1 / #2 / #3.
  state = { intro: FIRST === 1, ch: Math.max(FIRST, (() => { const h = parseInt((location.hash || '').replace('#', ''), 10); if (h >= 1 && h <= 3) return h - 1; try { const v = parseInt(localStorage.getItem('thedigiciti.chapter'), 10); if (v >= 0 && v <= 2) return v; } catch (e) {} return 0; })()), from: -1, wipe: FIRST === 1, phase: FIRST === 1 ? 2 : 0, nxt: 0 };
  calcRef = React.createRef(); guideRef = React.createRef(); peekRef = React.createRef();
  componentDidMount() {
    try { localStorage.setItem('thedigiciti.chapter', this.state.ch); } catch (e) {}
    // laptops: the story opens on its chapter card (the coin, "Chapter 01 · Reading the map"), which irises open onto
    // the chapter — the same card every chapter change shows, so the first screen is never a half-drawn map
    if (this.state.intro) {
      this.busy = true;
      const hold = reducedMotion ? 300 : 1150;
      this.setState({ nxt: this.state.ch });
      setTimeout(() => this.setState({ intro: false }), hold - 250);                     // mount the chapter under the card
      setTimeout(() => this.setState({ phase: 3 }), hold);                               // the iris opens
      setTimeout(() => { this.setState({ wipe: false, phase: 0 }); this.busy = false; this.lastScene && this.guide(...this.lastScene); }, hold + 900);
    }
    // ── the story as ONE scroll ────────────────────────────────────────────────────────────────────────────
    // Every chapter publishes how far through it the reader is (rt.scrubber → window.tdcStory.progress; chapter 3
    // from its own page scroll): the active pill's gold bar moves with the scroll, earlier chapters stay full.
    // Pushing on past a chapter's end (or back past its start) builds the hand-off visibly — "Keep scrolling ·
    // Next: 02 Your numbers" with a ring that fills as you push — and the next chapter arrives through the coin card.
    this.prog = 0;
    this.paintProg = () => {
      const bars = document.querySelectorAll('[data-pbar]'), ch = this.state.ch;
      bars.forEach(b => { const i = +b.dataset.pbar, f = i < ch ? 1 : i > ch ? 0 : this.prog; const v = 'scaleX(' + f.toFixed(4) + ')'; if (b.__v !== v) { b.style.transform = v; b.__v = v; } });
    };
    this.peekTo = (f, d) => {
      const el = this.peekRef.current; if (!el) return;
      const ch = this.state.ch, tgt = d > 0 ? (ch < 2 ? ch + 1 : 'app') : (ch - 1 >= FIRST ? ch - 1 : null);
      if (tgt == null || this.busy || this.leaving) f = 0;
      const T = ['The journey', 'Reading the map', 'Your numbers'];
      if (f > 0 && el.__t !== String(tgt) + d) {
        el.__t = String(tgt) + d;
        el.querySelector('[data-peek-k]').textContent = d > 0 ? 'Keep scrolling · next' : 'Keep scrolling · back to';
        el.querySelector('[data-peek-t]').textContent = tgt === 'app' ? 'The app' : '0' + (tgt - FIRST + 1) + '  ' + T[tgt];
        el.querySelector('[data-peek-arrow]').style.transform = d > 0 ? '' : 'rotate(180deg)';
        el.style.top = d > 0 ? '' : 'calc(70px + env(safe-area-inset-top))'; el.style.bottom = d > 0 ? '' : 'auto';
      }
      const o = f > .01 ? Math.min(1, .45 + f) : 0;
      el.style.opacity = o.toFixed(3); el.style.transform = 'translate(-50%,' + ((1 - f) * (d > 0 ? 14 : -14)).toFixed(1) + 'px)';
      el.querySelector('[data-peek-ring]').setAttribute('stroke-dashoffset', (94.25 * (1 - f)).toFixed(2));
    };
    // the step guide: which scene of how many, and — once the scene has finished playing — what to do next
    const touchy = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.guide = (i, n, playing) => {
      this.lastScene = [i, n, playing];
      const el = this.guideRef.current; if (!el) return;
      const ch = this.state.ch, on = ch !== 2 && !this.busy && !this.leaving;
      el.style.opacity = on ? '1' : '0'; el.style.transform = 'translate(-50%,' + (on ? 0 : 10) + 'px)';
      if (!on) return;
      const dots = el.querySelector('[data-guide-dots]');
      if (dots.__n !== n) { dots.__n = n; dots.innerHTML = Array.from({ length: n + 1 }, () => '<i style="display:block;width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.22);transition:width .35s,background .35s"></i>').join(''); }
      [...dots.children].forEach((d, k) => { d.style.width = k === i ? '18px' : '6px'; d.style.background = k < i ? 'rgba(246,196,69,.55)' : k === i ? '#f6c445' : 'rgba(255,255,255,.22)'; });
      el.querySelector('[data-guide-n]').textContent = 'Step ' + (i + 1) + ' of ' + (n + 1);
      const T = ['The journey', 'Reading the map', 'Your numbers'], next = i >= n ? (ch < 2 ? '0' + (ch + 1 - FIRST + 1) + ' · ' + T[ch + 1] : 'The app') : 'the next step';
      const arrow = touchy ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f6c445" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"></path></svg>' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f6c445" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"></path></svg>';
      const t = el.querySelector('[data-guide-t]');
      t.innerHTML = playing ? '<span style="color:rgba(255,246,234,.55)">Playing…</span>' : arrow + (touchy ? 'Swipe up for ' : 'Scroll for ') + next;
    };
    window.tdcStory = { progress: f => { this.prog = f; this.paintProg(); }, over: (f, d) => this.peekTo(f, d), scene: (i, n, p) => this.guide(i, n, p) };
    // chapter 3 is a page that scrolls natively; its scroll is its progress, and a push past its end (on to the app)
    // or back past its top (to the map) builds the same hand-off — only a push that STARTS at that end counts
    this.atEnd = () => { const c = this.calcRef.current; return this.state.ch === 2 && c && c.scrollTop + c.clientHeight >= c.scrollHeight - 4; };
    this.atTop = () => { const c = this.calcRef.current; return this.state.ch === 2 && c && c.scrollTop <= 2; };
    const OVER = 480; let wLast = -1e9, armed = 0, over = 0, decay = 0;
    const push = (dpx, d) => {
      over += Math.abs(dpx); this.peekTo(Math.min(1, over / OVER), d);
      clearTimeout(decay); decay = setTimeout(() => { over = 0; armed = 0; this.peekTo(0, d); }, 700);
      if (over >= OVER) { over = 0; armed = 0; this.peekTo(0, d); if (d > 0) this.toApp(); else this.goTo(1); }
    };
    this.onWheelEnd = e => {
      const now = e.timeStamp || performance.now(), fresh = now - wLast > 300; wLast = now;
      if (this.state.ch !== 2 || this.state.wipe || this.busy) { armed = 0; return; }
      const d = e.deltaY > 0 ? 1 : -1, dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if ((d > 0 && this.atEnd()) || (d < 0 && this.atTop() && FIRST <= 1)) { if (fresh) armed = d; if (armed === d) push(dy, d); }
      else if (armed) { armed = 0; over = 0; this.peekTo(0, d); }
    };
    this.onTouchS = e => { this.tY = e.touches[0].clientY; this.tEnd = this.atEnd(); this.tTop = this.atTop(); this.tOver = 0; };
    this.onTouchM = e => {
      if (this.state.ch !== 2 || this.tY == null || this.busy) return;
      const dy = this.tY - e.touches[0].clientY;
      if (dy > 0 && this.tEnd && this.atEnd()) this.peekTo(Math.min(1, dy / 140), 1);
      else if (dy < 0 && this.tTop && this.atTop()) this.peekTo(Math.min(1, -dy / 140), -1);
    };
    this.onTouchE = e => {
      if (this.state.ch !== 2 || this.tY == null) return;
      const dy = this.tY - e.changedTouches[0].clientY; this.tY = null; this.peekTo(0, dy > 0 ? 1 : -1);
      if (dy > 140 && this.tEnd && this.atEnd()) this.toApp(); else if (dy < -140 && this.tTop && this.atTop()) this.goTo(1);
    };
    this.onCalcScroll = () => { const c = this.calcRef.current; if (c) { this.prog = c.scrollHeight > c.clientHeight ? c.scrollTop / (c.scrollHeight - c.clientHeight) : 1; this.paintProg(); } };
    this.onKeyEnd = e => {
      if (e.key === 'Escape') { if (!this.leaving) { this.leaving = true; window.tdcVeil && window.tdcVeil.go('index.html', { style: 'sky', fast: true }); } return; }
      if (e.key === 'ArrowRight') this.goTo(this.state.ch + 1);
      if (e.key === 'ArrowLeft') this.goTo(this.state.ch - 1);
    };
    addEventListener('wheel', this.onWheelEnd, { passive: true });
    addEventListener('touchstart', this.onTouchS, { passive: true }); addEventListener('touchmove', this.onTouchM, { passive: true }); addEventListener('touchend', this.onTouchE, { passive: true });
    addEventListener('keydown', this.onKeyEnd);
    // chapter 3 is a page and scrolls natively (no inertia layer on top: the browser's own scrolling is the
    // most responsive there is, on every input device)
  }
  componentDidUpdate() {
    // chapter 3's page scroll feeds the progress bar; a chapter change repaints the bars
    const c = this.calcRef.current;
    if (c !== this.calcEl) { if (this.calcEl) this.calcEl.removeEventListener('scroll', this.onCalcScroll); this.calcEl = c; if (c) { c.addEventListener('scroll', this.onCalcScroll, { passive: true }); this.onCalcScroll(); } }
    if (this.paintedCh !== this.state.ch) { this.paintedCh = this.state.ch; if (!c) this.prog = this.state.from > this.state.ch ? 1 : 0; this.paintProg && this.paintProg(); }
  }
  componentWillUnmount() { if (window.tdcStory && window.tdcStory.progress) window.tdcStory = null; if (this.calcEl) this.calcEl.removeEventListener('scroll', this.onCalcScroll); removeEventListener('wheel', this.onWheelEnd); removeEventListener('touchstart', this.onTouchS); removeEventListener('touchmove', this.onTouchM); removeEventListener('touchend', this.onTouchE); removeEventListener('keydown', this.onKeyEnd); }
  toApp() {
    if (this.leaving) return; this.leaving = true;
    window.tdcVeil && window.tdcVeil.go('index.html#showcase', { style: 'sky' });
  }
  goTo(n) {
    n = Math.max(FIRST, Math.min(2, n));
    const gEl = this.guideRef && this.guideRef.current; if (gEl && n !== this.state.ch) { gEl.style.opacity = '0'; gEl.style.transform = 'translate(-50%,10px)'; }
    if (n === this.state.ch || this.busy) return;
    this.busy = true;
    this.setState({ wipe: true, phase: 0, nxt: n });
    requestAnimationFrame(() => requestAnimationFrame(() => this.setState({ phase: 1 })));
    // the next page of the same story: the coin card closes over the chapter (.6 s), names the next one, and opens
    // onto it already placed at its first scene (or its last, when going back) — 1.6 s in all, 0.3 s with reduced motion
    const k = reducedMotion ? .2 : 1;
    this.peekTo(0, 1);
    setTimeout(() => { this.setState(s => ({ ch: n, from: s.ch, phase: 2 })); try { localStorage.setItem('thedigiciti.chapter', n); history.replaceState(null, '', '#' + (n + 1)); } catch (e) {} }, 620 * k);
    setTimeout(() => this.setState({ phase: 3 }), 1000 * k);
    setTimeout(() => { this.setState({ wipe: false, phase: 0 }); this.busy = false; this.lastScene && this.guide(...this.lastScene); }, 1650 * k);
  }
  renderVals() {
    const { ch, from, wipe, phase, nxt } = this.state;
    const T = ['The journey', 'Reading the map', 'Your numbers'];
    const open = phase === 1 || phase === 2;
    const btn = i => `position:relative;display:flex;align-items:center;gap:8px;height:34px;padding:0 14px;border:0;border-radius:999px;font:inherit;font-size:11.5px;letter-spacing:.04em;white-space:nowrap;cursor:pointer;color:${ch === i ? '#fff6ea' : '#8a8ea3'};background:${ch === i ? 'rgba(246,196,69,.14)' : 'transparent'};transition:all .3s`;
    const dot = i => `width:7px;height:7px;border-radius:50%;flex:none;background:${ch === i ? '#f6c445' : 'rgba(255,255,255,.22)'};box-shadow:${ch === i ? '0 0 10px rgba(246,196,69,.8)' : 'none'};transition:all .3s`;
    const pv = e => { e && e.preventDefault && e.preventDefault(); };
    const no = i => '0' + (i - FIRST + 1);      // the chapter number as this screen counts it
    return {
      calcRef: this.calcRef, guideRef: this.guideRef, peekRef: this.peekRef,
      goHome: e => { pv(e); if (this.leaving) return; this.leaving = true; window.tdcVeil && window.tdcVeil.go('index.html', { style: 'sky', fast: true }); },
      isFlight: ch === 0, isLesson: ch === 1, isCalc: ch === 2 && !this.state.intro, showLesson: ch === 1 && !this.state.intro,
      flightFromEnd: ch === 0 && from === 1, lessonFromEnd: ch === 1 && from === 2,
      next0: () => this.goTo(1), next1: () => this.goTo(2), prev1: () => this.goTo(0),
      go0: e => { pv(e); this.goTo(0); }, go1: e => { pv(e); this.goTo(1); }, go2: e => { pv(e); this.goTo(2); },
      hasFlight: FIRST === 0, num1: no(1), num2: no(2),
      cur0: ch === 0 ? 'step' : null, cur1: ch === 1 ? 'step' : null, cur2: ch === 2 ? 'step' : null,
      ch0: btn(0), ch1: btn(1), ch2: btn(2), dot0: dot(0), dot1: dot(1), dot2: dot(2),
      wipeOn: wipe,
      wipeStyle: `position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;background:radial-gradient(ellipse 45% 50% at 50% 45%,rgba(246,196,69,.16),transparent 70%),radial-gradient(ellipse 50% 30% at 50% 100%,rgba(42,43,107,.6),transparent 70%),linear-gradient(180deg,#0c0e24,#0a0b16);transition:clip-path .6s cubic-bezier(.7,0,.3,1);clip-path:circle(${open ? '125%' : '0%'} at 50% 50%)`,
      labelStyle: `position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;opacity:${open ? 1 : 0};transform:scale(${open ? 1 : .8});transition:opacity .3s ease ${phase === 1 ? '.25s' : '0s'},transform .5s cubic-bezier(.2,.8,.2,1)`,
      nextNum: no(nxt), nextTitle: T[nxt]
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S("position:fixed;inset:0;overflow:hidden;background:#0b0c12")}, (R(v," isFlight ") ? [h("div", {"style": S("position:absolute;inset:0")}, h(C_story_1_journey, {"onNext": R(v," next0 "), "startAtEnd": R(v," flightFromEnd ")}))] : null), (R(v," showLesson ") ? [h("div", {"style": S("position:absolute;inset:0")}, h(C_story_2_map, {"onNext": R(v," next1 "), "onPrev": R(v," prev1 "), "startAtEnd": R(v," lessonFromEnd ")}))] : null), (R(v," isCalc ") ? [h("div", {"ref": R(v," calcRef "), "style": S("position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none")}, h(C_story_3_numbers, {}))] : null), h("div", {"style": S("position:absolute;left:0;right:0;top:0;z-index:40;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px clamp(16px,3vw,40px);pointer-events:none")}, h("a", {"href": "index.html", "onClick": R(v," goHome "), "aria-label": "Back to TheDigiCiti home", "style": S("pointer-events:auto;position:relative;display:flex;align-items:center;gap:12px;height:44px;padding:0 8px 0 5px;border-radius:999px;background:linear-gradient(180deg,rgba(255,244,222,.10),rgba(255,226,186,.03)),rgba(11,12,18,.5);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);box-shadow:inset 0 0 0 1px rgba(255,236,200,.18), inset 0 1px 0 rgba(255,255,255,.12), 0 10px 30px -12px rgba(0,0,0,.7);color:#E1E0CC;transition:box-shadow .35s, gap .35s"), "class": "p-story-1"}, h("span", {"style": S("width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#E1E0CC;color:#0b0c12;box-shadow:0 0 18px rgba(255,214,150,.35)")}, h("svg", {"width": "15", "height": "15", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M19 12H5M11 6l-6 6 6 6"}))), h("span", {"data-sh": "label", "style": S("display:flex;flex-direction:column;gap:3px;line-height:1")}, h("span", {"style": S("font-size:9px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,226,170,.75)")}, "Back to"), h("span", {"style": S("font-size:14px;font-weight:600;letter-spacing:-.01em")}, "TheDigiCiti")), h("span", {"data-sh": "label", "style": S("margin-left:4px;height:22px;min-width:30px;padding:0 6px;border-radius:6px;display:grid;place-items:center;font-size:10px;font-weight:600;letter-spacing:.04em;color:rgba(225,224,204,.55);box-shadow:inset 0 0 0 1px rgba(225,224,204,.2), inset 0 -2px 0 rgba(225,224,204,.08)")}, "esc")), h("nav", {"aria-label": "Chapters", "data-sh": "pills", "style": S("pointer-events:auto;display:flex;gap:2px;padding:4px;border-radius:999px;background:linear-gradient(180deg,rgba(255,244,222,.08),rgba(255,226,186,.02)),rgba(11,12,18,.5);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);box-shadow:inset 0 0 0 1px rgba(255,236,200,.16), inset 0 1px 0 rgba(255,255,255,.1), 0 10px 30px -12px rgba(0,0,0,.7)")}, (R(v," hasFlight ") ? [h("button", {"onClick": R(v," go0 "), "aria-current": R(v," cur0 "), "style": S(R(v," ch0 "))}, h("i", {"style": S(R(v," dot0 "))}), h("i", {"data-pbar": "0", "aria-hidden": "true", "style": S("position:absolute;left:14px;right:14px;bottom:3px;height:2px;border-radius:2px;background:linear-gradient(90deg,#d8961f,#f6c445);transform-origin:0 50%;transform:scaleX(0);pointer-events:none")}), h("span", {"data-sh": "label"}, h("b", {"style": S("font-weight:600;margin-right:6px;opacity:.7")}, "01"), "The journey"))] : null), h("button", {"onClick": R(v," go1 "), "aria-current": R(v," cur1 "), "style": S(R(v," ch1 "))}, h("i", {"style": S(R(v," dot1 "))}), h("i", {"data-pbar": "1", "aria-hidden": "true", "style": S("position:absolute;left:14px;right:14px;bottom:3px;height:2px;border-radius:2px;background:linear-gradient(90deg,#d8961f,#f6c445);transform-origin:0 50%;transform:scaleX(0);pointer-events:none")}), h("span", {"data-sh": "label"}, h("b", {"style": S("font-weight:600;margin-right:6px;opacity:.7")}, ...T(v,["", " num1 ", ""])), "Reading the map")), h("button", {"onClick": R(v," go2 "), "aria-current": R(v," cur2 "), "style": S(R(v," ch2 "))}, h("i", {"style": S(R(v," dot2 "))}), h("i", {"data-pbar": "2", "aria-hidden": "true", "style": S("position:absolute;left:14px;right:14px;bottom:3px;height:2px;border-radius:2px;background:linear-gradient(90deg,#d8961f,#f6c445);transform-origin:0 50%;transform:scaleX(0);pointer-events:none")}), h("span", {"data-sh": "label"}, h("b", {"style": S("font-weight:600;margin-right:6px;opacity:.7")}, ...T(v,["", " num2 ", ""])), "Your numbers"))), h("span", {"style": S("width:44px;flex:none")})), h("div", {"ref": R(v," peekRef "), "data-peek": "1", "aria-hidden": "true", "style": S("position:absolute;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));z-index:45;display:flex;align-items:center;gap:12px;padding:10px 16px 10px 12px;border-radius:999px;background:rgba(11,12,18,.78);box-shadow:inset 0 0 0 1px rgba(255,236,200,.18),0 14px 40px -12px rgba(0,0,0,.8);color:#fff6ea;pointer-events:none;opacity:0;transform:translate(-50%,14px);white-space:nowrap")}, h("span", {"style": S("position:relative;width:34px;height:34px;flex:none")}, h("svg", {"viewBox": "0 0 36 36", "width": "34", "height": "34", "style": S("position:absolute;inset:0;transform:rotate(-90deg)")}, h("circle", {"cx": "18", "cy": "18", "r": "15", "fill": "none", "stroke": "rgba(255,236,205,.18)", "stroke-width": "2.5"}), h("circle", {"data-peek-ring": "1", "cx": "18", "cy": "18", "r": "15", "fill": "none", "stroke": "#f6c445", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-dasharray": "94.25", "stroke-dashoffset": "94.25"})), h("svg", {"data-peek-arrow": "1", "viewBox": "0 0 24 24", "width": "16", "height": "16", "fill": "none", "stroke": "#f6c445", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "style": S("position:absolute;left:9px;top:9px")}, h("path", {"d": "M12 5v14M6 13l6 6 6-6"}))), h("span", {"style": S("display:flex;flex-direction:column;gap:3px;line-height:1")}, h("span", {"data-peek-k": "1", "style": S("font-size:9.5px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,226,170,.8)")}, "Keep scrolling"), h("span", {"data-peek-t": "1", "style": S("font-size:14px;font-weight:600;letter-spacing:-.01em")}, "Next chapter"))), h("div", {"ref": R(v," guideRef "), "data-guide": "1", "role": "status", "aria-live": "polite", "style": S("position:absolute;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));z-index:44;display:flex;align-items:center;gap:14px;padding:10px 18px 10px 14px;border-radius:999px;background:rgba(11,12,18,.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:inset 0 0 0 1px rgba(255,236,200,.16),0 14px 40px -12px rgba(0,0,0,.8);color:#fff6ea;pointer-events:none;opacity:0;transform:translate(-50%,10px);transition:opacity .35s,transform .35s;white-space:nowrap")}, h("span", {"data-guide-dots": "1", "style": S("display:flex;align-items:center;gap:5px")}), h("span", {"style": S("display:flex;flex-direction:column;gap:3px;line-height:1")}, h("span", {"data-guide-n": "1", "style": S("font-size:10px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,226,170,.8)")}), h("span", {"data-guide-t": "1", "style": S("display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;letter-spacing:-.01em;transition:opacity .3s")}))), h("div", {"style": S("position:absolute;inset:0;z-index:50;pointer-events:none")}, (R(v," wipeOn ") ? [h("div", {"style": S(R(v," wipeStyle "))}, h("div", {"style": S("position:absolute;inset:0;background-image:radial-gradient(rgba(255,236,190,.16) 1px,transparent 1.2px);background-size:28px 28px;-webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 30%,transparent 90%);mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 30%,transparent 90%)")}), h("div", {"style": S(R(v," labelStyle "))}, h("div", {"style": S("width:18vh;height:18vh;border-radius:50%;background:radial-gradient(circle at 34% 26%,#fff4c8 0%,#fbdb81 18%,#f6c445 45%,#d8961f 78%,#9a5f0c 100%);box-shadow:inset 0 0 0 .5vh #d8961f,inset 0 0 0 .65vh #9a5f0c,inset 0 -1.2vh 3vh rgba(90,50,0,.4),0 0 80px 20px rgba(246,196,69,.25);display:grid;place-items:center;animation:dcSpin 1.6s cubic-bezier(.45,0,.55,1) infinite")}, h("span", {"style": S("font-size:6vh;font-weight:600;color:#8a5208;text-shadow:0 1px 0 rgba(255,240,200,.6)")}, ...T(v,["", " nextNum ", ""]))), h("span", {"style": S("font-size:11px;letter-spacing:.32em;color:#f6c445")}, ...T(v,["CHAPTER ", " nextNum ", ""])), h("span", {"style": S("font-size:clamp(28px,3.6vw,52px);font-weight:500;letter-spacing:-.04em;line-height:1;color:#fff6ea;text-align:center")}, ...T(v,["", " nextTitle ", ""]))))] : null)))]; }
export const HELMET = [{"tag": "title", "attrs": {}, "text": "TheDigiCiti"}, {"tag": "style", "attrs": {"data-ds": ""}, "text": ":root{--night-0:#0b0c12;--night-1:#161826;--night-2:#171925;--night-3:#1e2130;--night-4:#242739;--night-5:#2c2f42;--night-6:#3a3d52;--ink-1:#ececf1;--ink-2:#a3a5b4;--ink-3:#7a7c8c;--ink-4:#4d4f5e;--violet-900:#2b2741;--violet-700:#4a4380;--violet-500:#7f72e0;--violet-300:#b5abfc;--violet-200:#d4cdfd;--violet-50:#f1effd;--grass-900:#1f4a13;--grass-800:#2a5a1c;--grass-700:#3f7e21;--grass-600:#4a9d47;--grass-500:#5cb85c;--grass-400:#6cba36;--grass-300:#8fd65a;--grass-200:#8fd48a;--grass-100:#b4e394;--grass-50:#e6f6d6;--gold-900:#2a261c;--gold-500:#f6c445;--gold-400:#e9c15c;--gold-300:#fbdb81;--gold-200:#f3e2a9;--sage-400:#8aa89b;--sage-300:#8fb7b0;--coral-500:#e2725b;--coral-400:#ec8a73;--slate-300:#8a8ea3;--slate-500:#666a7d;--slate-700:#313440;--slate-800:#20222d;--deck-cream:#f2ece0;--deck-cream-2:#fbf7ea;--deck-forest:#2f4034;--deck-forest-deep:#22312a;--deck-moss:#3f6b45;--deck-pine:#2f5537;--deck-sage:#7fa383;--deck-sage-2:#7fb37a;--deck-mute:#5d6b5f;--deck-line:#c5cdbf;--deck-gold:#e0b13f;--deck-brick:#a3322b;--bg-app:var(--night-1);--bg-tool:var(--night-0);--surface-card:var(--night-3);--surface-card-2:var(--night-2);--surface-raised:#24273a;--border-hairline:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);--text-primary:var(--ink-1);--text-secondary:var(--ink-2);--text-muted:var(--ink-3);--text-faint:var(--ink-4);--accent:var(--violet-300);--accent-fill:var(--violet-900);--positive:var(--grass-300);--negative:var(--coral-500);--income:var(--gold-500);--risk-low:var(--grass-300);--risk-medium:var(--gold-500);--risk-high:var(--coral-500);--asset-arbitrage:var(--sage-400);--asset-gold:var(--gold-500);--asset-large:var(--grass-600);--asset-mid:var(--grass-500);--asset-small:var(--grass-200);}\n:root{--font-sans:'Inter',-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;--font-deck:'Inter',Arial,Helvetica,sans-serif;--fs-hero:36px;--fs-display:30px;--fs-headline:27px;--fs-title:23px;--fs-h2:18px;--fs-h3:15px;--fs-body:13px;--fs-small:11.5px;--fs-micro:10px;--fw-regular:400;--fw-medium:500;--fw-semibold:600;--lh-tight:1.1;--lh-snug:1.25;--lh-body:1.45;--tracking-eyebrow:.22em;--tracking-label:.14em;--tracking-tight:-.01em;--text-eyebrow:var(--fw-regular) var(--fs-micro)/1.2 var(--font-sans);--text-body:var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans);}\n:root{--space-1:2px;--space-2:4px;--space-3:6px;--space-4:8px;--space-5:10px;--space-6:12px;--space-7:16px;--space-8:18px;--space-9:22px;--space-10:28px;--space-11:36px;--gutter:22px;--radius-xs:4px;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:18px;--radius-2xl:24px;--radius-pill:999px;--radius-device:46px;--shadow-card:0 1px 0 rgba(255,255,255,.04) inset,0 8px 24px rgba(0,0,0,.25);--shadow-float:0 12px 32px rgba(0,0,0,.45);--shadow-sheet:0 -12px 40px rgba(0,0,0,.5);--glow-green:0 0 24px rgba(143,214,90,.35);--glow-gold:0 0 18px rgba(246,196,69,.35);--glow-violet:0 0 18px rgba(181,171,252,.35);--ease-out:cubic-bezier(.22,1,.36,1);--ease-spring:cubic-bezier(.34,1.56,.64,1);--dur-fast:140ms;--dur-base:240ms;--dur-slow:420ms;--tabbar-h:59px;}\nbody{margin:0;background:var(--bg-app);color:var(--text-primary);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;font-feature-settings:\"tnum\" 1,\"cv11\" 1}a{color:var(--violet-300);text-decoration:none}a:hover{color:var(--violet-200)}.dv-eyebrow{font:var(--text-eyebrow);letter-spacing:var(--tracking-eyebrow);text-transform:uppercase;color:var(--text-secondary)}\n:root{--night-0:#0b0c12;--night-1:#161826;--night-2:#171925;--night-3:#1e2130;--night-4:#242739;--night-5:#2c2f42;--night-6:#3a3d52;--ink-1:#ececf1;--ink-2:#a3a5b4;--ink-3:#7a7c8c;--ink-4:#4d4f5e;--violet-900:#2b2741;--violet-700:#4a4380;--violet-500:#7f72e0;--violet-300:#b5abfc;--violet-200:#d4cdfd;--violet-50:#f1effd;--grass-900:#1f4a13;--grass-800:#2a5a1c;--grass-700:#3f7e21;--grass-600:#4a9d47;--grass-500:#5cb85c;--grass-400:#6cba36;--grass-300:#8fd65a;--grass-200:#8fd48a;--grass-100:#b4e394;--grass-50:#e6f6d6;--gold-900:#2a261c;--gold-500:#f6c445;--gold-400:#e9c15c;--gold-300:#fbdb81;--gold-200:#f3e2a9;--sage-400:#8aa89b;--sage-300:#8fb7b0;--coral-500:#e2725b;--coral-400:#ec8a73;--slate-300:#8a8ea3;--slate-500:#666a7d;--slate-700:#313440;--slate-800:#20222d;--deck-cream:#f2ece0;--deck-cream-2:#fbf7ea;--deck-forest:#2f4034;--deck-forest-deep:#22312a;--deck-moss:#3f6b45;--deck-pine:#2f5537;--deck-sage:#7fa383;--deck-sage-2:#7fb37a;--deck-mute:#5d6b5f;--deck-line:#c5cdbf;--deck-gold:#e0b13f;--deck-brick:#a3322b;--bg-app:var(--night-1);--bg-tool:var(--night-0);--surface-card:var(--night-3);--surface-card-2:var(--night-2);--surface-raised:#24273a;--border-hairline:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);--text-primary:var(--ink-1);--text-secondary:var(--ink-2);--text-muted:var(--ink-3);--text-faint:var(--ink-4);--accent:var(--violet-300);--accent-fill:var(--violet-900);--positive:var(--grass-300);--negative:var(--coral-500);--income:var(--gold-500);--risk-low:var(--grass-300);--risk-medium:var(--gold-500);--risk-high:var(--coral-500);--asset-arbitrage:var(--sage-400);--asset-gold:var(--gold-500);--asset-large:var(--grass-600);--asset-mid:var(--grass-500);--asset-small:var(--grass-200);}:root{--font-sans:'Inter',-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;--font-deck:'Inter',Arial,Helvetica,sans-serif;--fs-hero:36px;--fs-display:30px;--fs-headline:27px;--fs-title:23px;--fs-h2:18px;--fs-h3:15px;--fs-body:13px;--fs-small:11.5px;--fs-micro:10px;--fw-regular:400;--fw-medium:500;--fw-semibold:600;--lh-tight:1.1;--lh-snug:1.25;--lh-body:1.45;--tracking-eyebrow:.22em;--tracking-label:.14em;--tracking-tight:-.01em;--text-eyebrow:var(--fw-regular) var(--fs-micro)/1.2 var(--font-sans);--text-body:var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans);}:root{--space-1:2px;--space-2:4px;--space-3:6px;--space-4:8px;--space-5:10px;--space-6:12px;--space-7:16px;--space-8:18px;--space-9:22px;--space-10:28px;--space-11:36px;--gutter:22px;--radius-xs:4px;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:18px;--radius-2xl:24px;--radius-pill:999px;--radius-device:46px;--shadow-card:0 1px 0 rgba(255,255,255,.04) inset,0 8px 24px rgba(0,0,0,.25);--shadow-float:0 12px 32px rgba(0,0,0,.45);--shadow-sheet:0 -12px 40px rgba(0,0,0,.5);--glow-green:0 0 24px rgba(143,214,90,.35);--glow-gold:0 0 18px rgba(246,196,69,.35);--glow-violet:0 0 18px rgba(181,171,252,.35);--ease-out:cubic-bezier(.22,1,.36,1);--ease-spring:cubic-bezier(.34,1.56,.64,1);--dur-fast:140ms;--dur-base:240ms;--dur-slow:420ms;--tabbar-h:59px;}body{margin:0;background:var(--bg-app);color:var(--text-primary);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;font-feature-settings:\"tnum\" 1,\"cv11\" 1}a{color:var(--violet-300);text-decoration:none}a:hover{color:var(--violet-200)}.dv-eyebrow{font:var(--text-eyebrow);letter-spacing:var(--tracking-eyebrow);text-transform:uppercase;color:var(--text-secondary)}"}, {"tag": "script", "attrs": {"src": "part-transitions.js"}, "text": ""}, {"tag": "script", "attrs": {}, "text": "window.tdcVeil && window.tdcVeil.prefetch([\"index.html\"]);"}, {"tag": "style", "attrs": {}, "text": "html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:#0b0c12;color:#ececf1;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}a{color:#f6c445;text-decoration:none}a:hover{color:#fbdb81}@keyframes dcSpin{0%{transform:scaleX(1)}50%{transform:scaleX(.12)}100%{transform:scaleX(1)}}@keyframes dcRise{0%{opacity:0;transform:translateY(14px)}100%{opacity:1;transform:translateY(0)}}@media (max-width:640px){[data-sh=\"label\"]{display:none!important}[data-sh=\"pills\"] button{padding:0 10px!important}}"}];
export default defineDC("story", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
