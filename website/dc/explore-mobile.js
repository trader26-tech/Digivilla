import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber } from './rt.js?v=84057f3f';
import C_calc_mobile from './calc-mobile.js?v=84057f3f';
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {
  state = { calcMounted: false, calcOpen: false };
  root = React.createRef(); svgRef = React.createRef();
  N = 9;
  /** The hand-drawn look, baked once: every pen path becomes a polyline that wanders ±1 unit off
   *  its line (two low-frequency sines, integer frequencies so closed shapes still meet). Same
   *  picture as the prototype's turbulence + displacement filter, with nothing to re-render while
   *  the stroke draws itself. */
  wobble(svg) {
    if (!svg || !svg.querySelector) return;
    const NS = 'http://www.w3.org/2000/svg', tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('fill', 'none'); svg.appendChild(tmp);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    svg.querySelectorAll('[data-sk] path').forEach(p => {
      const out = [];
      (p.getAttribute('d') || '').split(/(?=M)/).forEach(sub => {
        sub = sub.trim(); if (!sub) return;
        const closed = /z\s*$/i.test(sub);
        tmp.setAttribute('d', sub);
        let L = 0; try { L = tmp.getTotalLength(); } catch (e) { L = 0; }
        if (!(L > 0)) { out.push(sub); return; }
        const n = Math.max(6, Math.ceil(L / 3)), amp = Math.min(1.1, L / 110);          // short strokes (arrowheads) barely wander
        const f1 = 2 + Math.floor(rnd() * 3), f2 = 5 + Math.floor(rnd() * 4), a1 = rnd() * 6.2832, a2 = rnd() * 6.2832;
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, s = t * L, q = tmp.getPointAtLength(s);
          const q1 = tmp.getPointAtLength(Math.max(0, s - .5)), q2 = tmp.getPointAtLength(Math.min(L, s + .5));
          let dx = q2.x - q1.x, dy = q2.y - q1.y; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
          const w = amp * (Math.sin(t * f1 * 6.2832 + a1) + .5 * Math.sin(t * f2 * 6.2832 + a2));
          pts.push((q.x - dy * w).toFixed(2) + ' ' + (q.y + dx * w).toFixed(2));
        }
        out.push('M' + pts.join('L') + (closed ? 'Z' : ''));
      });
      if (out.length) p.setAttribute('d', out.join(''));
    });
    tmp.remove();
  }
  componentDidMount() {
    const r = this.root.current; if (!r) return;
    this.s = -1;
    const rm = reducedMotion, k = rm ? 0 : 1;
    try { this.wobble(this.svgRef.current); } catch (e) { console.warn('wobble', e); }
    // one step → what enters draws itself (pen) or pops; what leaves fades; captions slide in from the side they come from
    this.apply = (s, prev) => {
      let maxT = 0;
      r.querySelectorAll('[data-in]').forEach(el => {
        const a = +el.dataset.in, o = el.dataset.out != null ? +el.dataset.out : 99;
        const vis = s >= a && s < o, was = prev >= a && prev < o, entering = vis && !was && s > prev;
        const dur = +(el.dataset.draw || 0) * k, d = entering ? +(el.dataset.delay || 0) * k : 0, pop = el.dataset.pop;
        clearTimeout(el._t);
        if (el.dataset.draw) {
          if (vis) {
            if (entering) { el.style.transition = 'none'; el.style.strokeDashoffset = '1'; el.getBoundingClientRect(); el.style.transition = `stroke-dashoffset ${dur}s cubic-bezier(.45,.05,.35,1) ${d}s, opacity .2s ease ${d}s`; maxT = Math.max(maxT, d + dur); }
            else if (!was) el.style.transition = 'opacity .3s';
            el.style.strokeDashoffset = '0'; el.style.opacity = '1';
          } else {
            el.style.transition = 'opacity .3s'; el.style.opacity = '0';
            el._t = setTimeout(() => { el.style.transition = 'none'; el.style.strokeDashoffset = '1'; }, 320);
          }
        } else {
          el.style.transition = `opacity ${.45 * k}s ease ${d}s, transform ${.6 * k}s cubic-bezier(.3,1.6,.5,1) ${d}s`;
          el.style.opacity = vis ? '1' : '0';
          if (pop) el.style.transform = vis ? 'scale(1)' : 'scale(.4)';
          if (entering && pop) maxT = Math.max(maxT, d + .6 * k);
        }
      });
      r.querySelectorAll('[data-cap]').forEach(c => { const i = +c.dataset.cap; c.classList.toggle('on', i === s); c.classList.toggle('before', i < s); });
      r.querySelectorAll('[data-dot]').forEach(dn => { const i = +dn.dataset.dot; dn.classList.toggle('on', i === s); dn.classList.toggle('done', i < s); });
      const dim = r.querySelector('[data-dim]'); if (dim) dim.style.opacity = s === 4 ? '.22' : '1';
      const hint = r.querySelector('[data-hint]'); if (hint) hint.style.opacity = s === this.N - 1 ? '0' : '1';
      const cnt = r.querySelector('[data-count]'); if (cnt) cnt.textContent = String(s + 1).padStart(2, '0') + ' / ' + String(this.N).padStart(2, '0');
      return maxT;
    };
    this.go = dir => {
      if (this.state.calcOpen || this.leaving) return false;
      const n = Math.max(0, Math.min(this.N - 1, this.s + dir));
      if (n === this.s) return false;
      // never gated: a step's drawing plays at its designed pace, but the next input steps at once (the
      // drawing still under way simply carries on, or fades if that step leaves)
      const prev = this.s; this.s = n;
      this.apply(n, prev);
      document.documentElement.dataset.step = String(n);
      try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
      return true;
    };
    // ONE gesture = ONE step (user, 2026-10-17: "1 scroll on phone is becoming too many scrolls"): a swipe steps once
    // it has moved 40 px and never again in the same touch (bringing the finger back before lifting undoes it);
    // a mouse notch or a trackpad swipe — including its momentum tail — is one step, like the story chapters
    let acc = 0, wLast = -1e9, wDone = false, wPeak = 0, wLow = 1e9, ty = null, tx = null, done = 0, side = null;
    this.onWheel = e => {
      e.preventDefault(); if (e.ctrlKey) return;
      const now = e.timeStamp || performance.now(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY, a = Math.abs(dy);
      if (a > wPeak) { wPeak = a; wLow = a; } else wLow = Math.min(wLow, a);
      const fresh = now - wLast > 260 || (acc && Math.sign(dy) !== Math.sign(acc)) || (wDone && wLow < wPeak * .35 && a > 24 && a > wLow * 3);
      wLast = now;
      if (fresh) { acc = 0; wDone = false; wPeak = a; wLow = a; }
      acc += dy;
      if (!wDone && Math.abs(acc) >= 26) { wDone = true; this.go(acc > 0 ? 1 : -1); }
    };
    this.onTS = e => { ty = e.touches[0].clientY; tx = e.touches[0].clientX; done = 0; side = null; };
    this.onTM = e => {
      if (ty == null) return;
      const t = e.touches[0], dy = ty - t.clientY, dx = t.clientX - tx;
      if (side == null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) side = Math.abs(dx) > Math.abs(dy);
      if (side !== false) return;
      const n = Math.abs(dy) >= 40 ? Math.sign(dy) : 0;      // one step per swipe, whatever its length
      if (n !== done) { if (done) this.go(-done); if (n && this.go(n)) done = n; else done = 0; }
    };
    this.onTE = () => { ty = null; };
    this.onKey = e => {
      if (e.key === 'Escape') { if (this.state.calcOpen) this.closeCalc(); else this.leave('index.html'); return; }
      if (this.state.calcOpen) return;
      if (['ArrowDown', 'PageDown', ' ', 'ArrowRight'].includes(e.key)) { e.preventDefault(); this.go(1); }
      else if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); this.go(-1); }
    };
    r.addEventListener('wheel', this.onWheel, { passive: false });
    r.addEventListener('touchstart', this.onTS, { passive: true });
    r.addEventListener('touchmove', this.onTM, { passive: true });
    r.addEventListener('touchend', this.onTE, { passive: true }); r.addEventListener('touchcancel', this.onTE, { passive: true });
    addEventListener('keydown', this.onKey);
    // the axes draw themselves as the veil lifts (fonts + first paint in)
    ready.then(() => setTimeout(() => { if (this.s < 0 && !this.dead) this.go(1); }, 150));
    // the calculator mounts quietly once the lesson is under way, so step 9 opens it at once
    const idle = cb => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1200));
    setTimeout(() => idle(() => { if (!this.dead && !this.state.calcMounted) this.setState({ calcMounted: true }); }), 1500);
  }
  componentWillUnmount() {
    this.dead = true;
    const r = this.root.current;
    if (r) { r.removeEventListener('wheel', this.onWheel); r.removeEventListener('touchstart', this.onTS); r.removeEventListener('touchmove', this.onTM); r.removeEventListener('touchend', this.onTE); r.removeEventListener('touchcancel', this.onTE); }
    removeEventListener('keydown', this.onKey);
  }
  openCalc() {
    if (this.state.calcOpen || this.leaving) return;
    this.setState({ calcMounted: true, calcOpen: true });
    document.documentElement.dataset.calc = '1';
    try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
  }
  closeCalc() {
    if (!this.state.calcOpen) return;
    this.setState({ calcOpen: false });
    delete document.documentElement.dataset.calc;
  }
  leave(url) {
    if (this.leaving) return; this.leaving = true;
    if (window.tdcVeil) window.tdcVeil.go(url, { style: 'sky', fast: true }); else location.href = url;
  }
  renderVals() {
    const open = this.state.calcOpen;
    return {
      root: this.root, svgRef: this.svgRef,
      lessonCls: 'xpl-lesson' + (open ? ' away' : ''), calcCls: 'xpl-calc' + (open ? ' open' : ''),
      calcOpen: open, calcHidden: open ? 'false' : 'true', calcMounted: this.state.calcMounted,
      next: () => this.go && this.go(1),
      goHome: e => { e.preventDefault(); e.stopPropagation(); this.leave('index.html'); },
      goCalc: e => { e.preventDefault(); e.stopPropagation(); this.openCalc(); },
      closeCalc: () => this.closeCalc(),
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"class": "xpl"}, h("div", {"ref": R(v," root "), "class": R(v," lessonCls "), "inert": R(v," calcOpen ")}, h("div", {"class": "xpl-grid"}), h("div", {"class": "xpl-col"}, h("div", {"class": "xpl-head"}, h("a", {"href": "index.html", "onClick": R(v," goHome "), "aria-label": "Back to TheDigiCiti", "class": "xpl-pill xpl-back"}, h("i", {}, h("svg", {"width": "15", "height": "15", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M19 12H5M11 6l-6 6 6 6"}))), h("span", {}, "TheDigiCiti")), h("button", {"type": "button", "onClick": R(v," goCalc "), "class": "xpl-pill xpl-skip"}, "Skip")), h("div", {"class": "xpl-prog", "aria-hidden": "true"}, h("span", {"data-dot": "0"}), h("span", {"data-dot": "1"}), h("span", {"data-dot": "2"}), h("span", {"data-dot": "3"}), h("span", {"data-dot": "4"}), h("span", {"data-dot": "5"}), h("span", {"data-dot": "6"}), h("span", {"data-dot": "7"}), h("span", {"data-dot": "8"})), h("div", {"class": "xpl-graph", "onClick": R(v," next ")}, h("svg", {"ref": R(v," svgRef "), "class": "xpl-svg", "viewBox": "0 0 360 360", "aria-hidden": "true"}, h("defs", {}, h("linearGradient", {"id": "xlg", "gradientUnits": "userSpaceOnUse", "x1": "112", "y1": "262", "x2": "268", "y2": "94"}, h("stop", {"offset": "0", "stop-color": "#8fd65a"}), h("stop", {"offset": ".5", "stop-color": "#f6c445"}), h("stop", {"offset": "1", "stop-color": "#e2725b"})), h("radialGradient", {"id": "xgG"}, h("stop", {"offset": "0", "stop-color": "#8fd65a", "stop-opacity": ".6"}), h("stop", {"offset": ".5", "stop-color": "#8fd65a", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#8fd65a", "stop-opacity": "0"})), h("radialGradient", {"id": "xgR"}, h("stop", {"offset": "0", "stop-color": "#e2725b", "stop-opacity": ".65"}), h("stop", {"offset": ".5", "stop-color": "#e2725b", "stop-opacity": ".3"}), h("stop", {"offset": "1", "stop-color": "#e2725b", "stop-opacity": "0"})), h("radialGradient", {"id": "xgY"}, h("stop", {"offset": "0", "stop-color": "#f6c445", "stop-opacity": ".42"}), h("stop", {"offset": ".55", "stop-color": "#f6c445", "stop-opacity": ".14"}), h("stop", {"offset": "1", "stop-color": "#f6c445", "stop-opacity": "0"})), h("radialGradient", {"id": "xhG"}, h("stop", {"offset": "0", "stop-color": "#8fd65a", "stop-opacity": ".75"}), h("stop", {"offset": ".45", "stop-color": "#8fd65a", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#8fd65a", "stop-opacity": "0"})), h("radialGradient", {"id": "xhY"}, h("stop", {"offset": "0", "stop-color": "#f6c445", "stop-opacity": ".75"}), h("stop", {"offset": ".45", "stop-color": "#f6c445", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#f6c445", "stop-opacity": "0"})), h("radialGradient", {"id": "xhR"}, h("stop", {"offset": "0", "stop-color": "#e2725b", "stop-opacity": ".75"}), h("stop", {"offset": ".45", "stop-color": "#e2725b", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#e2725b", "stop-opacity": "0"}))), h("g", {"data-dim": "1"}, h("ellipse", {"data-in": "5", "data-out": "6", "cx": "96", "cy": "268", "rx": "64", "ry": "38", "fill": "url(#xgG)"}), h("ellipse", {"data-in": "6", "data-out": "7", "cx": "282", "cy": "74", "rx": "64", "ry": "38", "fill": "url(#xgR)"}), h("g", {"data-sk": "1", "fill": "none", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"class": "pen", "data-in": "0", "data-draw": "1.6", "d": "M44 318 C43 250 45 170 43.5 100 C43 70 44.5 46 44 28", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "0", "data-draw": ".5", "data-delay": "1.5", "d": "M33 44 L44 26 L55 44", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "0", "data-draw": "1.6", "data-delay": "1.9", "d": "M44 318 C110 317 190 319.5 260 318 C295 317.5 318 318.5 338 318", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "0", "data-draw": ".5", "data-delay": "3.4", "d": "M322 307 L340 318 L322 329", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "1", "data-out": "2", "data-draw": ".9", "d": "M66 214 L66 146 M57 160 L66 144 L75 160", "pathLength": "1", "stroke": "#f6c445", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "1", "data-out": "2", "data-draw": ".9", "data-delay": ".5", "d": "M184 296 L254 296 M240 287 L256 296 L240 305", "pathLength": "1", "stroke": "#f6c445", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "2", "data-out": "3", "data-draw": "2.8", "data-delay": ".2", "d": "M62 46 C100 43 140 45 172 44 C174 70 173 96 174 122 C136 124 98 122 62 123 C60 96 63 70 62.5 48", "pathLength": "1", "stroke": "#f6c445", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "3", "data-draw": "2.4", "data-delay": ".1", "d": "M58 288 C44 288 42 268 58 264 C56 248 76 242 86 252 C92 238 116 238 120 254 C134 248 146 262 136 272 C148 280 138 294 124 290 C112 298 72 298 58 288 Z", "pathLength": "1", "stroke": "#8fd65a", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "3", "data-draw": "2.4", "data-delay": ".7", "d": "M244 94 C230 94 228 74 244 70 C242 54 262 48 272 58 C278 44 302 44 306 60 C320 54 332 68 322 78 C334 86 324 100 310 96 C298 104 258 104 244 94 Z", "pathLength": "1", "stroke": "#e2725b", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "6", "data-out": "7", "data-draw": "1.8", "data-delay": ".2", "d": "M236 124 L250 114 L262 146 L274 132 L290 198 M281 186 L290 200 L298 187", "pathLength": "1", "stroke": "#e2725b", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "7", "data-draw": "2.6", "data-delay": ".3", "d": "M112 262 Q170 200 268 94", "pathLength": "1", "stroke": "url(#xlg)", "stroke-width": "3.4"})), h("g", {}, h("text", {"data-in": "1", "x": "26", "y": "180", "text-anchor": "middle", "transform": "rotate(-90 26 180)", "font-size": "22", "fill": "#fff6ea"}, "Return"), h("text", {"data-in": "1", "x": "300", "y": "348", "text-anchor": "middle", "font-size": "22", "fill": "#fff6ea"}, "Risk"), h("text", {"data-in": "1", "data-out": "2", "x": "78", "y": "186", "font-size": "20", "fill": "#fbdb81"}, "more return"), h("text", {"data-in": "1", "data-out": "2", "x": "220", "y": "284", "text-anchor": "middle", "font-size": "20", "fill": "#fbdb81"}, "more risk"), h("text", {"data-in": "2", "data-out": "3", "x": "118", "y": "92", "text-anchor": "middle", "font-size": "28", "fill": "#fbdb81"}, "Ideal spot"), h("text", {"data-in": "3", "x": "96", "y": "277", "text-anchor": "middle", "font-size": "20", "fill": "#cdeec0"}, "Arbitrage"), h("text", {"data-in": "3", "x": "284", "y": "82", "text-anchor": "middle", "font-size": "18", "fill": "#ffd2c7"}, "Stocks & MFs"), h("text", {"data-in": "5", "data-out": "6", "x": "150", "y": "282", "font-size": "22", "fill": "#8fd65a"}, "≈5.5% a yr"), h("text", {"data-in": "6", "data-out": "7", "x": "300", "y": "214", "font-size": "22", "fill": "#e2725b"}, "−52%"), h("text", {"data-in": "8", "data-pop": "1", "x": "154", "y": "246", "font-size": "18", "fill": "#8fd65a"}, "Conservative"), h("text", {"data-in": "8", "data-pop": "1", "data-delay": ".4", "x": "192", "y": "206", "font-size": "18", "fill": "#f6c445"}, "Balanced"), h("text", {"data-in": "8", "data-pop": "1", "data-delay": ".8", "x": "232", "y": "161", "font-size": "18", "fill": "#e2725b"}, "Aggressive")), h("circle", {"data-in": "8", "data-pop": "1", "cx": "143.5", "cy": "228.3", "r": "20", "fill": "url(#xhG)"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".4", "cx": "180", "cy": "189", "r": "20", "fill": "url(#xhY)"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".8", "cx": "221.5", "cy": "144.3", "r": "20", "fill": "url(#xhR)"}), h("circle", {"data-in": "8", "data-pop": "1", "cx": "143.5", "cy": "228.3", "r": "7", "fill": "#8fd65a", "stroke": "#0b0c12", "stroke-width": "3"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".4", "cx": "180", "cy": "189", "r": "7", "fill": "#f6c445", "stroke": "#0b0c12", "stroke-width": "3"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".8", "cx": "221.5", "cy": "144.3", "r": "7", "fill": "#e2725b", "stroke": "#0b0c12", "stroke-width": "3"})), h("ellipse", {"data-in": "4", "data-out": "5", "data-pop": "1", "cx": "190", "cy": "178", "rx": "122", "ry": "58", "fill": "url(#xgY)"}), h("text", {"data-in": "4", "data-out": "5", "data-pop": "1", "x": "190", "y": "200", "text-anchor": "middle", "font-size": "72", "fill": "#fbdb81"}, "₹1 Cr"))), h("div", {"class": "xpl-card", "onClick": R(v," next ")}, h("div", {"class": "xpl-caps"}, h("div", {"data-cap": "0", "class": "xpl-cap c0"}, h("span", {"class": "xpl-title"}, "Return & risk")), h("div", {"data-cap": "1", "class": "xpl-cap"}, h("span", {"class": "k"}, "How to read it"), h("span", {"class": "h"}, "Up means more return. Right means more risk.")), h("div", {"data-cap": "2", "class": "xpl-cap"}, h("span", {"class": "k"}, "The ideal spot"), h("span", {"class": "h"}, "High return, low risk."), h("span", {"class": "b"}, "Top left. Everyone wants to be here.")), h("div", {"data-cap": "3", "class": "xpl-cap"}, h("span", {"class": "k"}, "Where money goes"), h("span", {"class": "h"}, "Two real choices."), h("span", {"class": "list"}, h("span", {}, h("b", {"class": "g"}, "Arbitrage"), " · safe, but low return"), h("span", {}, h("b", {"class": "r"}, "Stocks & MFs"), " · high return, big swings"))), h("div", {"data-cap": "4", "class": "xpl-cap"}, h("span", {"class": "k red"}, "The problem"), h("span", {"class": "h big"}, "Say you have ₹1 crore."), h("span", {"class": "b"}, "Where do you put it?")), h("div", {"data-cap": "5", "class": "xpl-cap"}, h("span", {"class": "k grn"}, "Option one"), h("span", {"class": "h"}, "All of it in arbitrage?"), h("span", {"class": "tick"}, h("span", {}, h("b", {"class": "g"}, "✓"), "Your capital stays safe."), h("span", {}, h("b", {"class": "r"}, "✕"), "≈5.5% a year. Barely beats inflation."))), h("div", {"data-cap": "6", "class": "xpl-cap"}, h("span", {"class": "k red"}, "Option two"), h("span", {"class": "h"}, "All of it in stocks?"), h("span", {"class": "tick"}, h("span", {}, h("b", {"class": "g"}, "✓"), "Strong growth over the long run."), h("span", {}, h("b", {"class": "r"}, "✕"), "Some years it falls 50%. Could you hold on?"))), h("div", {"data-cap": "7", "class": "xpl-cap"}, h("span", {"class": "k"}, "How we solve it"), h("span", {"class": "h"}, "Not one or the other."), h("span", {"class": "b"}, "The line between them.")), h("div", {"data-cap": "8", "class": "xpl-cap"}, h("span", {"class": "k"}, "Your villas"), h("span", {"class": "h"}, "Three villas on that line."), h("a", {"href": "calculator.html", "onClick": R(v," goCalc "), "class": "xpl-cta"}, "See it with your money", h("i", {}, h("svg", {"width": "16", "height": "16", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M5 12h14M13 6l6 6-6 6"})))))), h("div", {"data-hint": "1", "class": "xpl-foot"}, h("span", {"data-count": "1"}, "01 / 09"), h("span", {"class": "sw"}, "Tap or swipe up", h("svg", {"width": "14", "height": "14", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M6 15l6-6 6 6"}))))))), h("div", {"class": R(v," calcCls "), "aria-hidden": R(v," calcHidden ")}, (R(v," calcMounted ") ? [h(C_calc_mobile, {"onBack": R(v," closeCalc ")})] : null)))]; }
export const HELMET = [{"tag": "title", "attrs": {}, "text": "TheDigiCiti — Return & risk"}, {"tag": "meta", "attrs": {"name": "viewport", "content": "width=device-width, initial-scale=1, viewport-fit=cover"}, "text": ""}, {"tag": "style", "attrs": {"data-ds": ""}, "text": ":root{--night-0:#0b0c12;--night-1:#161826;--night-2:#171925;--night-3:#1e2130;--night-4:#242739;--night-5:#2c2f42;--night-6:#3a3d52;--ink-1:#ececf1;--ink-2:#a3a5b4;--ink-3:#7a7c8c;--ink-4:#4d4f5e;--violet-900:#2b2741;--violet-700:#4a4380;--violet-500:#7f72e0;--violet-300:#b5abfc;--violet-200:#d4cdfd;--violet-50:#f1effd;--grass-900:#1f4a13;--grass-800:#2a5a1c;--grass-700:#3f7e21;--grass-600:#4a9d47;--grass-500:#5cb85c;--grass-400:#6cba36;--grass-300:#8fd65a;--grass-200:#8fd48a;--grass-100:#b4e394;--grass-50:#e6f6d6;--gold-900:#2a261c;--gold-500:#f6c445;--gold-400:#e9c15c;--gold-300:#fbdb81;--gold-200:#f3e2a9;--sage-400:#8aa89b;--sage-300:#8fb7b0;--coral-500:#e2725b;--coral-400:#ec8a73;--slate-300:#8a8ea3;--slate-500:#666a7d;--slate-700:#313440;--slate-800:#20222d;--deck-cream:#f2ece0;--deck-cream-2:#fbf7ea;--deck-forest:#2f4034;--deck-forest-deep:#22312a;--deck-moss:#3f6b45;--deck-pine:#2f5537;--deck-sage:#7fa383;--deck-sage-2:#7fb37a;--deck-mute:#5d6b5f;--deck-line:#c5cdbf;--deck-gold:#e0b13f;--deck-brick:#a3322b;--bg-app:var(--night-1);--bg-tool:var(--night-0);--surface-card:var(--night-3);--surface-card-2:var(--night-2);--surface-raised:#24273a;--border-hairline:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);--text-primary:var(--ink-1);--text-secondary:var(--ink-2);--text-muted:var(--ink-3);--text-faint:var(--ink-4);--accent:var(--violet-300);--accent-fill:var(--violet-900);--positive:var(--grass-300);--negative:var(--coral-500);--income:var(--gold-500);--risk-low:var(--grass-300);--risk-medium:var(--gold-500);--risk-high:var(--coral-500);--asset-arbitrage:var(--sage-400);--asset-gold:var(--gold-500);--asset-large:var(--grass-600);--asset-mid:var(--grass-500);--asset-small:var(--grass-200);}"}, {"tag": "script", "attrs": {"src": "part-transitions.js"}, "text": ""}, {"tag": "script", "attrs": {}, "text": "window.tdcVeil && window.tdcVeil.prefetch([\"index.html\"]);"}, {"tag": "style", "attrs": {}, "text": "\n/* ── EXPLORE (phones) · the \"Return & risk\" lesson, 9 steps, then the calculator full-screen ────\n   Ported from the explore-flow handoff (Story Mobile.html). Same look and timing; built to stay\n   smooth on any phone: the hand-drawn look is BAKED into the path data once at mount (no SVG\n   displacement filter re-rendering while the pen draws), glows are radial gradients (no Gaussian\n   blur, no drop-shadows), nothing uses backdrop-filter, every move is opacity/transform or a\n   stroke-dashoffset draw. One tap or one swipe = one step; the card and the graph both advance.\n   Step 9's CTA (or Skip) slides the phone calculator up over the lesson, full screen — the app's\n   engine on real history, every control on one screen, nothing to scroll. */\nhtml,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:#0b0c12}\n.xpl{position:fixed;inset:0;overflow:hidden;color:#fff6ea;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;background:radial-gradient(ellipse 70% 40% at 50% 34%,rgba(246,196,69,.12),transparent 70%),radial-gradient(ellipse 80% 30% at 50% 100%,rgba(42,43,107,.55),transparent 70%),linear-gradient(180deg,#0c0e24,#0a0b16)}\n.xpl *{box-sizing:border-box}\n.xpl-lesson{position:absolute;inset:0;touch-action:none;transition:transform .55s cubic-bezier(.2,.8,.2,1),opacity .45s ease;will-change:transform}\n.xpl-lesson.away{transform:scale(.94);opacity:.35;pointer-events:none}\n.xpl-grid{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,236,190,.14) 1px,transparent 1.2px);background-size:24px 24px;-webkit-mask-image:radial-gradient(ellipse 80% 55% at 50% 38%,#000 35%,transparent 95%);mask-image:radial-gradient(ellipse 80% 55% at 50% 38%,#000 35%,transparent 95%)}\n.xpl-col{position:relative;height:100%;max-width:480px;margin:0 auto;display:flex;flex-direction:column;padding:max(12px,env(safe-area-inset-top)) 16px max(14px,env(safe-area-inset-bottom))}\n.xpl-head{flex:none;display:flex;justify-content:space-between;align-items:center;gap:12px}\n.xpl-pill{display:flex;align-items:center;height:44px;border-radius:999px;border:0;font:inherit;cursor:pointer;color:#E1E0CC;text-decoration:none;-webkit-user-select:none;user-select:none}\n.xpl-back{gap:10px;padding:0 14px 0 5px;background:rgba(11,12,18,.62);box-shadow:inset 0 0 0 1px rgba(255,236,200,.18);font-size:14px;font-weight:600;letter-spacing:-.01em}\n.xpl-back i{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#E1E0CC;color:#0b0c12}\n.xpl-skip{padding:0 16px;background:transparent;font-size:13px;font-weight:500;color:rgba(225,224,204,.8);box-shadow:inset 0 0 0 1px rgba(225,224,204,.18)}\n.xpl-prog{flex:none;display:flex;gap:5px;margin-top:14px}\n.xpl-prog>span{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.12);transition:background .4s}\n.xpl-prog>span.done{background:rgba(246,196,69,.45)}.xpl-prog>span.on{background:#f6c445}\n.xpl-graph{flex:1;min-height:0;position:relative;cursor:pointer}\n.xpl-svg{position:absolute;left:0;top:10px;width:100%;height:calc(100% - 20px);overflow:visible}\n.xpl-svg [data-in]{opacity:0}\n.xpl-svg .pen{stroke-dasharray:1;stroke-dashoffset:1}\n.xpl-svg [data-pop]{transform-box:fill-box;transform-origin:center;transform:scale(.4)}\n.xpl-svg [data-dim]{transition:opacity .6s ease}\n.xpl-svg text{font-family:Caveat,cursive;font-weight:700;pointer-events:none}\n.xpl-card{flex:none;position:relative;height:clamp(190px,28svh,212px);display:flex;flex-direction:column;padding:22px 22px 16px;border-radius:26px;background:linear-gradient(180deg,rgba(255,244,222,.07),rgba(255,226,186,.03)),rgba(18,19,32,.9);box-shadow:inset 0 0 0 1px rgba(255,236,200,.14),0 30px 60px -30px rgba(0,0,0,.8);cursor:pointer;-webkit-user-select:none;user-select:none}\n.xpl-caps{position:relative;flex:1}\n.xpl-cap{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;opacity:0;transform:translateY(14px);transition:opacity .4s ease,transform .5s cubic-bezier(.2,.8,.2,1);pointer-events:none}\n.xpl-cap.c0{justify-content:center;align-items:center}\n.xpl-cap.before{transform:translateY(-14px)}\n.xpl-cap.on{opacity:1;transform:none;pointer-events:auto}\n.xpl-cap .k{font-size:11px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:#f6c445}\n.xpl-cap .k.red{color:#e2725b}.xpl-cap .k.grn{color:#8fd65a}\n.xpl-cap .h{font-size:26px;font-weight:600;letter-spacing:-.035em;line-height:1.14;text-wrap:balance}\n.xpl-cap .h.big{font-size:30px;letter-spacing:-.04em;line-height:1.1}\n.xpl-cap .b{font-size:15px;line-height:1.45;color:rgba(255,246,234,.7)}\n.xpl-cap .list{display:flex;flex-direction:column;gap:5px;font-size:14.5px;line-height:1.35;color:rgba(255,246,234,.75)}\n.xpl-cap .list b{font-weight:600}.xpl-cap .g{color:#8fd65a}.xpl-cap .r{color:#e2725b}\n.xpl-cap .tick{display:flex;flex-direction:column;gap:5px;font-size:14.5px;line-height:1.35;color:#fff6ea}.xpl-cap .tick>span{display:flex;gap:10px}.xpl-cap .tick b{font-weight:600}\n.xpl-title{font-family:Caveat,cursive;font-size:34px;font-weight:700;color:#fbdb81}\n.xpl-cta{margin-top:auto;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 6px 0 20px;border-radius:999px;border:0;font:inherit;cursor:pointer;background:#E1E0CC;color:#0b0c12;font-size:15px;font-weight:600;text-decoration:none;box-shadow:0 0 30px rgba(255,214,150,.35);animation:xplGlow 2.4s ease-in-out infinite}\n.xpl-cta i{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#0b0c12;color:#E1E0CC}\n.xpl-foot{flex:none;display:flex;justify-content:space-between;align-items:center;padding-top:10px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:rgba(225,224,204,.5);transition:opacity .3s}\n.xpl-foot .sw{display:flex;align-items:center;gap:6px}\n.xpl-foot .sw svg{animation:xplBob 2.2s ease-in-out infinite}\n@keyframes xplBob{0%,100%{transform:translateY(1px)}50%{transform:translateY(-3px)}}\n@keyframes xplGlow{0%,100%{box-shadow:0 0 22px rgba(255,214,150,.28)}50%{box-shadow:0 0 36px rgba(255,214,150,.5)}}\n.xpl-calc{position:fixed;inset:0;z-index:20;--pvh:100%;background:#0b0c12;transform:translate3d(0,100%,0);visibility:hidden;will-change:transform;transition:transform .55s cubic-bezier(.2,.8,.2,1),visibility 0s linear .55s}\n.xpl-calc.open{transform:none;visibility:visible;transition:transform .55s cubic-bezier(.2,.8,.2,1),visibility 0s}\n.xpl-calc>.sc-host{height:100%}\n@media (prefers-reduced-motion:reduce){.xpl-lesson,.xpl-cap,.xpl-calc,.xpl-prog>span{transition:none}.xpl-foot .sw svg,.xpl-cta{animation:none}}\n"}];
export default defineDC("explore-mobile", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
