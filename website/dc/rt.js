// TheDigiCiti — tiny runtime for the compiled design components.
//
// The design handoff ships each screen as a `.dc.html` file: inline-styled
// markup with {{ holes }}, <sc-if>/<sc-for>, <dc-import>, plus a `Component`
// class whose renderVals() feeds the holes. `_source/build.py` compiles every
// file into a plain ES module that renders with Preact through this file, so
// the site behaves exactly like the prototype without its in-browser compiler
// (React + Babel from a CDN).
import { h, render, Component, createRef, Fragment } from './vendor/preact.mjs?v=1bb3bce2';

export { h, render, Fragment };

/** What the prototype's component classes see as `React`. */
export const React = { createRef, createElement: h, Fragment };

// ── values ───────────────────────────────────────────────────────────────────
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const IDENT_RE = /^[A-Za-z_$][\w$]*/;

function wrapsWhole(e) {
  let d = 0;
  for (let i = 0; i < e.length - 1; i++) {
    if (e[i] === '(') d++;
    else if (e[i] === ')') { d--; if (d === 0) return false; }
  }
  return true;
}
function topLevelEq(e) {
  let d = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '[' || c === '(') d++;
    else if (c === ']' || c === ')') d--;
    else if (d === 0 && (c === '=' || c === '!') && e[i + 1] === '=') {
      if (i > 0 && (e[i - 1] === '=' || e[i - 1] === '!')) continue;
      if (!e.slice(0, i).trim()) continue;
      return { index: i, op: e[i + 2] === '=' ? c + '==' : c + '=' };
    }
  }
  return null;
}
function path(vals, e) {
  const head = e.match(IDENT_RE);
  if (!head) return undefined;
  let cur = vals == null ? undefined : vals[head[0]];
  let i = head[0].length;
  while (i < e.length) {
    if (e[i] === '.') {
      const m = e.slice(i + 1).match(IDENT_RE) || e.slice(i + 1).match(/^\d+/);
      if (!m) return undefined;
      cur = cur == null ? undefined : cur[m[0]];
      i += 1 + m[0].length;
    } else if (e[i] === '[') {
      let d = 1, j = i + 1;
      while (j < e.length && d > 0) { if (e[j] === '[') d++; else if (e[j] === ']') { d--; if (d === 0) break; } j++; }
      if (d !== 0) return undefined;
      const k = R(vals, e.slice(i + 1, j));
      cur = cur == null ? undefined : cur[k];
      i = j + 1;
    } else return undefined;
  }
  return cur;
}
/** Resolve a {{ hole }} expression against the render values (same rules as
 *  the prototype runtime: paths, !, ==/===/!=/!==, literals). */
export function R(vals, src) {
  const e = String(src).trim();
  if (!e) return undefined;
  if (e[0] === '(' && e[e.length - 1] === ')' && wrapsWhole(e)) return R(vals, e.slice(1, -1));
  const eq = topLevelEq(e);
  if (eq) {
    const l = R(vals, e.slice(0, eq.index)), r = R(vals, e.slice(eq.index + eq.op.length));
    return eq.op === '===' ? l === r : eq.op === '!==' ? l !== r : eq.op === '==' ? l == r : l != r; // eslint-disable-line eqeqeq
  }
  if (e[0] === '!') return !R(vals, e.slice(1));
  if (e === 'true') return true;
  if (e === 'false') return false;
  if (e === 'null') return null;
  if (e === 'undefined') return undefined;
  if (NUMBER_RE.test(e)) return Number(e);
  if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return e.slice(1, -1);
  return path(vals, e);
}
/** An attribute mixing text and holes: "CHAPTER {{ n }}". */
export function J(vals, parts) {
  let s = '';
  for (let i = 0; i < parts.length; i++) s += i & 1 ? (R(vals, parts[i]) ?? '') : parts[i];
  return s;
}
/** A text node with holes → children (each hole in a span, as the prototype). */
export function T(vals, parts) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (!(i & 1)) { if (parts[i]) out.push(parts[i]); continue; }
    const v = R(vals, parts[i]);
    if (v == null || typeof v === 'boolean') continue;
    if (typeof v === 'object') { out.push(v); continue; }
    out.push(h('span', { class: 'sc-interp' }, String(v)));
  }
  return out;
}

// ── styles ───────────────────────────────────────────────────────────────────
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const styleCache = new Map();
function toObj(css) {
  const o = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const p = decl.slice(0, i).trim();
    o[p.startsWith('--') ? p : camel(p)] = decl.slice(i + 1).trim();
  }
  return o;
}
/** Inline style string → style object (cached, so an unchanged style keeps its
 *  identity and never touches the DOM on re-render — imperative styles set by
 *  the animation code survive, exactly as with React). */
export function S(css) {
  if (css == null || typeof css === 'object') return css;
  let o = styleCache.get(css);
  if (!o) { o = toObj(css); if (styleCache.size < 4000) styleCache.set(css, o); }
  return o;
}

let sheet = null;
/** Append CSS (the compiled `style-hover="…"` rules) once. */
export function addCSS(text) {
  if (!text) return;
  if (!sheet) { sheet = document.createElement('style'); sheet.setAttribute('data-dc', ''); document.head.appendChild(sheet); }
  sheet.textContent += text + '\n';
}

// ── helmets (each component's <head> needs) ─────────────────────────────────
const seen = new Set();
function helmetKey(n) { return n.tag + '|' + (n.attrs.href || n.attrs.src || '') + '|' + (n.text || ''); }
for (const el of document.head.querySelectorAll('link[href],script[src]')) {
  seen.add((el.tagName.toLowerCase()) + '|' + (el.getAttribute('href') || el.getAttribute('src')) + '|');
}
function installHelmet(nodes) {
  for (const n of nodes) {
    const k = helmetKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    if (n.tag === 'title') continue;
    const el = document.createElement(n.tag);
    for (const [a, v] of Object.entries(n.attrs)) el.setAttribute(a, v);
    if (n.text) el.textContent = n.text;
    document.head.appendChild(el);
  }
}

// ── components ───────────────────────────────────────────────────────────────
/** Base for the prototype's `class Component extends DCLogic`. */
export class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; this.__host = null; }
  setState(update, cb) { this.__host && this.__host.__setLogicState(update, cb); }
  forceUpdate() { this.__host && this.__host.forceUpdate(); }
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() { return {}; }
}

const HOST_STYLE = new Set(['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'zIndex', 'transform']);
/** The positioning subset of a <dc-import style="…"> that lands on its host div. */
export function hostStyle(css) {
  const all = S(css);
  if (!all) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(all)) if (HOST_STYLE.has(k)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Wrap a compiled template + its logic class as a Preact component that
 *  renders `<div class="sc-host">…</div>`, like the prototype's host. */
export function defineDC(name, Logic, tpl, defaults, helmet) {
  return class DC extends Component {
    constructor(props) {
      super(props);
      if (helmet && helmet.length && window.__dcStaticHelmet !== name) installHelmet(helmet);
      this.state = { __v: 0 };
      try { this.logic = new (Logic || DCLogic)(this.userProps()); } catch (e) { console.error(name, e); this.logic = new DCLogic(this.userProps()); }
      this.logic.__host = this;
    }
    userProps() {
      const { __hostStyle, ...rest } = this.props;
      return { ...defaults, ...rest };
    }
    __setLogicState(update, cb) {
      const prev = this.logic.state;
      const patch = typeof update === 'function' ? update(prev) : update;
      this.logic.state = { ...prev, ...patch };
      this.setState((s) => ({ __v: s.__v + 1 }), cb);
    }
    componentDidMount() { try { this.logic.componentDidMount(); } catch (e) { console.error(name, e); } }
    componentDidUpdate(prev) {
      this.logic.props = this.userProps();
      try { this.logic.componentDidUpdate(prev); } catch (e) { console.error(name, e); }
    }
    componentWillUnmount() { try { this.logic.componentWillUnmount(); } catch (e) { console.error(name, e); } }
    render() {
      const up = this.userProps();
      this.logic.props = up;
      let vals = up;
      try { vals = { ...up, ...(this.logic.renderVals() || {}) }; } catch (e) { console.error(name + '.renderVals()', e); }
      return h('div', { class: 'sc-host', style: this.props.__hostStyle }, tpl(vals));
    }
  };
}

/** The design system's <Button> (the one design-system component the screens
 *  use, via <x-import>), rebuilt without React. */
const BTN = {
  light: { background: 'var(--violet-50)', color: '#1a1830', border: '1px solid transparent' },
  outline: { background: 'transparent', color: 'var(--ink-1)', border: '1px solid var(--border-strong)' },
  accent: { background: 'transparent', color: 'var(--ink-1)', border: '1px solid var(--violet-500)' },
  ghost: { background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--border-strong)' },
};
const SIZES = {
  sm: { height: '32px', padding: '0 14px', fontSize: '13px', borderRadius: '999px' },
  md: { height: '36px', padding: '0 16px', fontSize: '14px', borderRadius: '10px' },
  lg: { height: '44px', padding: '0 20px', fontSize: '15px', borderRadius: '12px' },
};
export class DSButton extends Component {
  constructor(p) { super(p); this.state = { press: false }; }
  render() {
    const { variant = 'outline', size = 'lg', block, disabled, children, style = {}, ...rest } = this.props;
    const press = this.state.press;
    return h('button', {
      disabled,
      onPointerDown: () => this.setState({ press: true }),
      onPointerUp: () => this.setState({ press: false }),
      onPointerLeave: () => this.setState({ press: false }),
      ...rest,
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        fontFamily: 'var(--font-sans)', fontWeight: 400, cursor: disabled ? 'default' : 'pointer',
        width: block ? '100%' : undefined, opacity: disabled ? 0.4 : 1,
        transform: press && !disabled ? 'scale(.97)' : 'none',
        transition: 'transform 140ms var(--ease-out), background 140ms',
        ...BTN[variant], ...SIZES[size], ...S(style),
      },
    }, children);
  }
}

// ── motion helpers ───────────────────────────────────────────────────────────
/** True when the visitor asked the OS for less motion. */
export const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** (Unused — it locked input while a scene played; kept for API compatibility.)
 *  One step per wheel GESTURE — not per event. A trackpad flick fires dozens
 *  of wheel events over ~1s with momentum; the prototype stepped on the first
 *  one, ignored the rest while tweening, then stepped AGAIN on the tail. This
 *  arms once per gesture (a gap of `quiet` ms starts a new one) and fires when
 *  the accumulated delta passes `threshold`. */
export function wheelStepper(step, opts = {}) {
  const QUIET = opts.quiet ?? 260, TH = opts.threshold ?? 40;
  let acc = 0, last = 0, armed = true, calmAt = 0, watch = 0;
  const handler = (e) => {
    e.preventDefault();
    // the event's own clock: a main-thread stall mid-gesture must not look like a pause
    const now = e.timeStamp || performance.now();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
    // busy while a scene tweens, and for a beat after it lands — so a scroll
    // that is still rolling when the tween ends can't fire the next scene
    const busy = !!(opts.busy && opts.busy()) || now < calmAt;
    // a real pause starts a new gesture — never while busy
    if (now - last > QUIET && !busy) { armed = true; acc = 0; }
    last = now;
    if (!armed) return;
    acc += dy;
    if (Math.abs(acc) < TH) return;
    armed = false; acc = 0;
    if (busy) return;
    step(dy > 0 ? 1 : -1);
    // once the scene lands, hold for a beat before the next can fire
    if (opts.busy) { clearInterval(watch); watch = setInterval(() => { if (!opts.busy()) { clearInterval(watch); calmAt = performance.now() + 400; } }, 40); }
  };
  handler.dispose = () => clearInterval(watch);
  return handler;
}

/** (Unused since 2026-10-17 — the landing and chapter 3 scroll natively; kept for API compatibility.)
 *  Lenis-style smooth scrolling for an overflow container: wheel input moves
 *  a target and the scroll position eases toward it every frame (time-based),
 *  so a flick has weight and settles instead of stopping dead. Touch, keyboard
 *  and programmatic scrolls stay native and simply re-sync the target. */
export function smoothScroll(el, opts = {}) {
  const k = opts.ease ?? 7.5;
  let kk = k, target = el.scrollTop, pos = target, expect = -1, active = false;
  const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
  const onWheel = (e) => {
    if (e.ctrlKey) return;                                   // pinch-zoom
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
    e.preventDefault();
    if (!active) { pos = target = el.scrollTop; active = true; }
    kk = Math.abs(dy) < 40 ? 14 : k;        // trackpad (small, frequent deltas) brings its own momentum — just smooth it; wheel notches glide
    target = Math.max(0, Math.min(max(), target + dy));
  };
  const onScroll = () => { if (Math.abs(el.scrollTop - expect) > 1.5) { pos = target = el.scrollTop; active = false; } };
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('scroll', onScroll, { passive: true });
  return {
    get target() { return target; },
    get active() { return active; },
    /** glide to y; `ease` (per-second rate) overrides the wheel feel for this move — lower is more cinematic */
    scrollTo(y, ease) { pos = el.scrollTop; target = Math.max(0, Math.min(max(), y)); active = true; kk = ease ?? k; },
    tick(dt) {
      if (!active) return;
      pos += (target - pos) * (1 - Math.exp(-dt * kk));
      if (Math.abs(target - pos) < .4) { pos = target; active = false; }
      expect = pos; el.scrollTop = pos;
    },
    destroy() { el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', onScroll); },
  };
}

/** Scroll-scrubbed scenes — the story as one scroll.
 *  ONE scale, the same in every chapter: a mouse-wheel notch = one scene; a trackpad's (or any pixel-precise
 *  wheel's) SCENE_PX of travel = one scene; a finger's TOUCH_PX = one scene. The scroll position IS the
 *  timeline: the scenes follow it closely (a short time-based ease, no gate, no lock), so a slow scroll draws
 *  slowly, a fast one passes several scenes, and scrolling back plays the story backwards mid-scene.
 *  When a trackpad or a finger stops part-way, the story lands on a complete scene: forward if it had gone at
 *  least a third of the way (COMMIT), else back — never slower than the scene's designed pace (`rateFor`),
 *  never longer than ~0.6 s, and any new input takes over at once. Nothing rests half-drawn.
 *  Pushing on past either end builds a hand-off (OVER px; the shell shows it filling) and then calls onEnd(±1) —
 *  only for a push that STARTED at that end (a scroll that runs into the end stops there).
 *  The shell, if any, hears window.tdcStory.progress(pos / max) and window.tdcStory.over(f 0…1, dir).
 *  API: onWheel/onTS/onTM/onTE, step(d), set(v), pos, target, settling, tick(now), attach(), detach(). */
export const SCENE_PX = 800, TOUCH_PX = 300;
/** STEP model (2026-10-17, user: "scroll is hard to understand, it fast-forwards"): ONE gesture = ONE scene, and the
 *  scene plays at its designed pace (`rateFor`), so every drawing and caption is seen as designed.
 *  A gesture is a burst of input: a mouse-wheel notch, a trackpad swipe INCLUDING its momentum tail, a finger swipe,
 *  an arrow key. A new swipe that starts inside a momentum tail is detected (the delta jumps back up) and counts.
 *  Never locked: a gesture during a playing scene queues the next one (at most one ahead) and the current scene
 *  hurries a little; a backward gesture reverses at once (quickly — a drawing un-drawn slowly helps nobody).
 *  At either end a NEW gesture (one that starts there, after the scene has finished) hands over via onEnd(±1).
 *  The shell hears window.tdcStory.progress(pos / max), .over(f, dir) and .scene(i, n, playing). */
export function scrubber(opts) {
  const max = opts.max, GAP = 260, MIN = 26, PACE = 1.25;   // ms of quiet that ends a gesture · px a swipe must travel · pace × design
  let target = opts.start ?? 0, pos = target, lastT = 0, shown = -1, sceneShown = '';
  let wLast = -1e9, wAcc = 0, wDone = false, wPeak = 0, wLow = 1e9, ty = null, ty0 = 0, tDone = false;
  const hook = (k, a, b, c) => { const st = window.tdcStory; if (st && st[k]) { try { st[k](a, b, c); } catch (e) { /* the shell's problem */ } } };
  const clamp = (v) => Math.max(0, Math.min(max, v));
  const playing = () => Math.abs(target - pos) > .0005;
  /** one deliberate gesture in direction d */
  const go = (d) => {
    if (opts.onInput) opts.onInput();
    if (opts.gate && !opts.gate()) return;
    if (d > 0) {
      if (!playing() && pos >= max - 1e-6) { hook('over', 1, 1); opts.onEnd && opts.onEnd(1); return; }
      if (target - pos > 1 - 1e-6) return;                       // one scene already queued
      target = clamp(Math.floor(target + 1e-6) + 1);
    } else {
      if (!playing() && pos <= 1e-6) { hook('over', 1, -1); opts.onEnd && opts.onEnd(-1); return; }
      target = clamp(playing() && target > pos ? Math.floor(pos + 1e-6) : Math.ceil(target - 1e-6) - 1);   // mid-scene: back to its start
    }
  };
  const now = (e) => e.timeStamp || performance.now();
  const api = {
    beginGesture() {},
    onWheel: (e) => {
      if (e.ctrlKey) return; e.preventDefault();
      const t = now(e), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY, a = Math.abs(dy);
      // a new gesture: after a quiet gap, on a direction change, or a fresh swipe rising out of a momentum tail that had
      // clearly DECAYED (below 35 % of its peak) — a swipe's own rising start is never mistaken for a second swipe
      if (a > wPeak) { wPeak = a; wLow = a; } else wLow = Math.min(wLow, a);
      const fresh = t - wLast > GAP || (wAcc && Math.sign(dy) !== Math.sign(wAcc)) || (wDone && wLow < wPeak * .35 && a > 24 && a > wLow * 3);
      wLast = t;
      if (fresh) { wAcc = 0; wDone = false; wPeak = a; wLow = a; }
      wAcc += dy;
      if (!wDone && Math.abs(wAcc) >= MIN) { wDone = true; go(wAcc > 0 ? 1 : -1); }
    },
    onTS: (e) => { ty = ty0 = e.touches[0].clientY; tDone = false; },
    onTM: (e) => {
      if (ty == null) return; e.preventDefault();
      ty = e.touches[0].clientY;
      if (!tDone && Math.abs(ty0 - ty) >= MIN * 1.5) { tDone = true; go(ty0 - ty > 0 ? 1 : -1); }   // finger up = forward
    },
    onTE: () => { ty = null; },
    /** one whole scene (keys, the shell's buttons) */
    step(d) { go(d > 0 ? 1 : -1); },
    set(v) { target = pos = clamp(v); shown = -1; sceneShown = ''; },
    get pos() { return pos; },
    get target() { return target; },
    get settling() { return playing(); },
    tick(t) {
      const dt = Math.min(.05, lastT ? (t - lastT) / 1000 : 0); lastT = t;
      const d = target - pos;
      if (Math.abs(d) < .0005 || reducedMotion) pos = target;
      else {
        const seg = Math.max(0, Math.min(max - 1, Math.floor(Math.min(pos, target) + 1e-6)));
        const designed = (opts.rateFor ? opts.rateFor(seg) : 1 / 1.2) * PACE;          // scenes per second
        const rate = d < 0 ? Math.max(designed * 3, 2.2) : designed * (d > 1 ? 1.8 : 1);   // back: brisk · queued: hurry the current one
        pos += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      }
      if (pos !== shown) { shown = pos; hook('progress', max ? pos / max : 1); }
      const k = Math.round(playing() ? target : pos) + '|' + (playing() ? 1 : 0);
      if (k !== sceneShown) { sceneShown = k; hook('scene', Math.round(playing() ? target : pos), max, playing()); }
      return pos;
    },
    attach() { addEventListener('wheel', api.onWheel, { passive: false }); addEventListener('touchstart', api.onTS, { passive: true }); addEventListener('touchmove', api.onTM, { passive: false }); addEventListener('touchend', api.onTE, { passive: true }); addEventListener('touchcancel', api.onTE, { passive: true }); },
    detach() { removeEventListener('wheel', api.onWheel); removeEventListener('touchstart', api.onTS); removeEventListener('touchmove', api.onTM); removeEventListener('touchend', api.onTE); removeEventListener('touchcancel', api.onTE); },
  };
  return api;
}

/** Pre-render an element's CSS `filter` (drop-shadow glows, sepia …) into a
 *  canvas ONCE and swap it in. A CSS filter on an element that moves every
 *  frame is re-blurred every frame — several large blur passes on a retina
 *  texture, which is what made the landing stutter. The baked canvas is a
 *  plain texture: the same picture, composited for free.
 *  `holder` carries the filter and defines the box; `art` is the <img> or
 *  <svg> inside it. Falls back to leaving the CSS filter alone. */
export async function bakeFilter(holder, art, res = 1024) {
  try {
    let f = getComputedStyle(holder).filter, fOn = holder;
    if (!f || f === 'none') { f = getComputedStyle(art).filter; fOn = art; }
    if (!f || f === 'none' || !holder.clientWidth) return null;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return null;
    const hasCtxFilter = 'filter' in probe;             // Chrome/Firefox; Safari lacks it → SVG-filter route below
    let img, iw, ih;
    if (art.tagName === 'IMG') {
      if (!art.complete) await new Promise((r) => { art.onload = r; art.onerror = r; });
      if (art.decode) await art.decode().catch(() => {});
      img = art; iw = art.naturalWidth; ih = art.naturalHeight;
      if (!iw) return null;
    } else {
      const vb = (art.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      iw = vb[2] || art.clientWidth; ih = vb[3] || art.clientHeight;
      const c = art.cloneNode(true);
      c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', iw); c.setAttribute('height', ih); c.removeAttribute('style');
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml' }));
      img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      URL.revokeObjectURL(url);
    }
    // draw the art at `res` px wide; shadow lengths scale with it so the
    // result matches the CSS filter at today's on-screen size
    const k = res / holder.clientWidth;
    const resH = Math.round(res * ih / iw), pad = Math.round(res * 0.2);
    const cv = document.createElement('canvas');
    cv.width = res + 2 * pad; cv.height = resH + 2 * pad;
    const ctx = cv.getContext('2d');
    const fScaled = f.replace(/(-?\d*\.?\d+)px/g, (_, v) => (parseFloat(v) * k).toFixed(2) + 'px');
    if (hasCtxFilter) {
      ctx.filter = fScaled;
      ctx.drawImage(img, pad, pad, res, resH);
    } else {
      // Safari: let its SVG engine apply the same filter chain while rasterising
      const prims = cssFilterToSvg(fScaled);
      if (!prims) return null;
      const href = img.src || '';
      const inner = art.tagName === 'IMG'
        ? `<image href="${href.replace(/&/g, '&amp;')}" x="${pad}" y="${pad}" width="${res}" height="${resH}"/>`
        : `<svg x="${pad}" y="${pad}" width="${res}" height="${resH}" viewBox="${art.getAttribute('viewBox')}">${art.innerHTML}</svg>`;
      const doc = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${cv.width}" height="${cv.height}" viewBox="0 0 ${cv.width} ${cv.height}"><defs><filter id="f" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">${prims}</filter></defs><g filter="url(#f)">${inner}</g></svg>`;
      const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
      const fi = new Image();
      await new Promise((ok, no) => { fi.onload = ok; fi.onerror = no; fi.src = url; });
      URL.revokeObjectURL(url);
      ctx.drawImage(fi, 0, 0, cv.width, cv.height);
    }
    const cs = getComputedStyle(holder);
    if (cs.position === 'static') holder.style.position = 'relative';
    cv.style.cssText = `position:absolute;left:${-pad / res * 100}%;top:${-pad / resH * 100}%;width:${cv.width / res * 100}%;height:${cv.height / resH * 100}%;pointer-events:none;display:block`;
    cv.setAttribute('aria-hidden', 'true');
    fOn.style.filter = 'none';
    art.style.visibility = 'hidden';
    holder.appendChild(cv);
    return cv;
  } catch (e) { console.warn('bakeFilter', e); return null; }
}

/** A computed CSS `filter` string → SVG filter primitives (same chain, same
 *  order). Covers what the site uses: drop-shadow, sepia, brightness, plus a
 *  few cheap extras. Returns null for anything it can't express. */
function cssFilterToSvg(css) {
  const out = []; let n = 0, prev = 'SourceGraphic';
  const fns = css.match(/[a-z-]+\((?:[^()]|\([^()]*\))*\)/g) || [];
  const num = (s) => parseFloat(s);
  for (const fn of fns) {
    const name = fn.slice(0, fn.indexOf('(')), arg = fn.slice(fn.indexOf('(') + 1, -1).trim(), id = 'r' + (n++);
    if (name === 'drop-shadow') {
      const color = (arg.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+(?![\d.%-])/i) || ['#000'])[0];
      const lens = arg.replace(color, '').match(/-?\d*\.?\d+(?=px)/g) || [];
      const [dx = 0, dy = 0, blur = 0] = lens.map(num);
      let fc = color, fo = 1;
      const m = color.match(/rgba?\(([^)]*)\)/);
      if (m) { const c = m[1].split(/[\s,\/]+/).filter(Boolean).map(num); fc = `rgb(${c[0]},${c[1]},${c[2]})`; if (c.length > 3) fo = c[3]; }
      out.push(`<feDropShadow in="${prev}" dx="${dx}" dy="${dy}" stdDeviation="${(blur / 2).toFixed(2)}" flood-color="${fc}" flood-opacity="${fo}" result="${id}"/>`);
    } else if (name === 'sepia') {
      const a = Math.min(1, arg.endsWith('%') ? num(arg) / 100 : num(arg)), i = 1 - a;
      const v = [0.393 + 0.607 * i, 0.769 - 0.769 * i, 0.189 - 0.189 * i, 0, 0, 0.349 - 0.349 * i, 0.686 + 0.314 * i, 0.168 - 0.168 * i, 0, 0, 0.272 - 0.272 * i, 0.534 - 0.534 * i, 0.131 + 0.869 * i, 0, 0, 0, 0, 0, 1, 0];
      out.push(`<feColorMatrix in="${prev}" type="matrix" values="${v.map((x) => x.toFixed(4)).join(' ')}" result="${id}"/>`);
    } else if (name === 'brightness' || name === 'opacity') {
      const b = arg.endsWith('%') ? num(arg) / 100 : num(arg);
      out.push(name === 'brightness'
        ? `<feComponentTransfer in="${prev}" result="${id}"><feFuncR type="linear" slope="${b}"/><feFuncG type="linear" slope="${b}"/><feFuncB type="linear" slope="${b}"/></feComponentTransfer>`
        : `<feComponentTransfer in="${prev}" result="${id}"><feFuncA type="linear" slope="${b}"/></feComponentTransfer>`);
    } else if (name === 'saturate' || name === 'grayscale') {
      const a = arg.endsWith('%') ? num(arg) / 100 : num(arg);
      out.push(`<feColorMatrix in="${prev}" type="saturate" values="${name === 'saturate' ? a : 1 - Math.min(1, a)}" result="${id}"/>`);
    } else if (name === 'blur') {
      out.push(`<feGaussianBlur in="${prev}" stdDeviation="${num(arg)}" result="${id}"/>`);
    } else return null;
    prev = id;
  }
  return out.join('');
}

/** Resolves once the page is really ready to be looked at: the root has
 *  rendered, the fonts are in, and the images in the first viewport have
 *  decoded (capped so a slow image can never hold the page hostage). */
let readyResolve;
export const ready = new Promise((r) => { readyResolve = r; });
async function settle() {
  const cap = new Promise((r) => setTimeout(r, 1800));
  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  const imgs = [...document.images].filter((i) => {
    if (i.loading === 'lazy') return false;
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  });
  await Promise.race([cap, Promise.all([fonts, ...imgs.map((i) => (i.decode ? i.decode() : Promise.resolve()).catch(() => {}))])]);
  readyResolve();
  if (window.__tdcReadyResolve) window.__tdcReadyResolve();
}

/** Mount a page's root component into #dc-root. */
export function mount(Root) {
  render(h(Root, {}), document.getElementById('dc-root'));
  requestAnimationFrame(() => settle());
}

/** Page-by-page wheel/trackpad gestures. ONE physical gesture = ONE call of onStep(dir):
 *  - a trackpad swipe = a ramp-up plus a momentum tail that decays for 1–2 s: all one gesture;
 *  - a NEW gesture is (a) a reversal of direction, (b) a pause of > 250 ms, (c) the momentum cut short by a
 *    fresh finger (a short gap while the tail had decayed), or (d) deltas that climb again after decaying —
 *    a new swipe ramps UP, a tail only ever goes down;
 *  - a candidate commits only while its deltas are still rising (or big), so a hiccup in a tail never steps.
 *  Times come from the event (input time); `e.__ts` lets a test replay a trace on its own clock. */
export function pageGestures(onStep) {
  let lastT = -1e9, lastSign = 0, lastAbs = 0, peak = 0, acc = 0, used = true, prev = 0, rise = 0, frame = 16;
  return (e, dy) => {
    const ts = e.__ts != null ? e.__ts : (e.timeStamp || performance.now()), abs = Math.abs(dy), sign = Math.sign(dy);
    if (!sign) return;
    const gap = ts - lastT;
    rise = abs > lastAbs * 1.25 && abs > 2 ? rise + 1 : 0;                   // a momentum tail never climbs; a new swipe does
    // a busy frame merges queued tail events into one: its delta ≈ the last one × the frames it swallowed
    const k = gap / frame, merged = k > 1.5 && abs > lastAbs * .45 * k && abs < lastAbs * 1.6 * k;
    const fresh = (sign !== lastSign && abs > 1)
      || gap > 250
      || (gap > frame * 1.5 && lastAbs < peak * .5 && !merged)                // silence inside a tail = the momentum was cut by a finger
      || (lastAbs < peak * .35 && ((abs > Math.max(12, lastAbs * 2.2) && !merged) || rise >= 2));
    if (fresh) { used = false; acc = 0; peak = 0; prev = 0; rise = 0; }
    if (gap > 2 && gap < 40) frame = frame * .8 + gap * .2;                  // the device's event interval (8 ms on 120 Hz trackpads)
    lastT = ts; lastSign = sign; lastAbs = abs; peak = Math.max(peak, abs);
    if (used) { prev = abs; return; }
    acc += dy;
    if (Math.abs(acc) >= 18 && (abs >= prev || abs >= 30)) { used = true; onStep(sign); }
    prev = abs;
  };
}
