import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=4bdc6f8e';
/* ── logic, verbatim from the design file ── */
/* The narration: one recording, one segment per step (seconds into assets/voice/lesson.mp3, cut at the silences). */
const VOICE_URL = 'assets/voice/lesson.mp3';
const SEG = [[0, 4.32], [4.94, 12.92], [13.52, 20.2], [20.8, 32.64], [33.42, 37.04], [37.62, 45.36], [45.94, 53.76], [54.38, 58.96], [59.44, 68.2]];
const LEAD = 220, FADE_IN = .12, FADE_OUT = .18, PAUSE = 1100;   // the pen leads the voice; fades; the beat before the lesson moves on
const JOINED_KEY = 'tdc.circle.joined', VOICE_KEY = 'thedigiciti.voice';
const STEPS = [['Return & risk', 'Two lines — that’s all you need'], ['How to read it', 'Up is return, right is risk'], ['The ideal spot', 'High return, low risk'], ['Where money goes', 'Two real choices'], ['The problem', 'Say you have ₹1 crore'], ['Option one', 'All of it in arbitrage?'], ['Option two', 'All of it in stocks?'], ['How we solve it', 'Not one or the other'], ['Your villas', 'Three villas on that line']];
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
/* ONE voice per page, shared with the landing (which imports this module): it fetches the recording as the visitor heads
   for Explore (`prefetch`), and the tap that opens the lesson calls `unlock` — the AudioContext is created and resumed
   inside that tap, which is what lets the lesson speak the moment it opens, with no second tap. */
const V = window.__tdcVoice || (window.__tdcVoice = (() => {
  const v = { ctx: null, bytes: null, buf: null, decoding: null, unlocked: false };
  v.makeCtx = () => {
    if (v.ctx) return v.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try { v.ctx = new AC(); } catch (e) { v.ctx = null; }
    return v.ctx;
  };
  v.prefetch = () => v.bytes || (v.bytes = fetch(VOICE_URL).then(r => { if (!r.ok) throw new Error('voice ' + r.status); return r.arrayBuffer(); }));
  v.decode = () => v.decoding || (v.decoding = v.prefetch().then(bytes => {
    const ctx = v.makeCtx(); if (!ctx) throw new Error('no Web Audio');
    return new Promise((ok, no) => { const p = ctx.decodeAudioData(bytes.slice(0), ok, no); if (p && p.then) p.then(ok, no); });
  }).then(buf => (v.buf = buf), err => { v.decoding = null; throw err; }));
  v.unlock = () => {
    const ctx = v.makeCtx();
    if (ctx) { try { ctx.resume(); const b = ctx.createBuffer(1, 1, 22050), s0 = ctx.createBufferSource(); s0.buffer = b; s0.connect(ctx.destination); s0.start(0); } catch (e) {} }
    v.unlocked = true; v.decode().catch(() => {});
  };
  return v;
})());
class Component extends DCLogic {
  state = { calcMounted: false, calcOpen: false, voiceOn: store.get(VOICE_KEY) !== '0', speaking: false, waiting: false, inv: false, joined: store.get(JOINED_KEY) === '1', paused: false, steps: false, stepNow: -1 };
  root = React.createRef(); svgRef = React.createRef(); wpRef = React.createRef();
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
      this.maxSeen = Math.max(this.maxSeen || 0, s); const cardEl = r.querySelector('.xpl-card'); if (cardEl) cardEl.classList.toggle('last', s === this.N - 1); if (this.state.stepNow !== s) this.setState({ stepNow: s });
      const cnt = r.querySelector('[data-count]'); if (cnt) cnt.textContent = String(s + 1).padStart(2, '0') + ' / ' + String(this.N).padStart(2, '0');
      return maxT;
    };
    this.go = dir => {
      if (this.state.calcOpen || this.state.inv || this.leaving) return false;
      const n = Math.max(0, Math.min(this.N - 1, this.s + dir));
      if (n !== this.s && this.cur && this.state.paused) this.wake();   // leaving a paused line: let the audio clock run again
      if (n === this.s) return false;
      // never gated: a step's drawing plays at its designed pace, but the next input steps at once (the
      // drawing still under way simply carries on, or fades if that step leaves)
      const prev = this.s; this.s = n;
      const t = this.apply(n, prev);
      this.drawEnd = performance.now() + t * 1000;
      document.documentElement.dataset.step = String(n);
      try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
      // the voice: cut the line that was playing, start this step's line a beat after the pen (going back replays it)
      this.hush(); clearTimeout(this.sayT); this.sayT = setTimeout(() => this.say(n), LEAD);
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
      if (e.key === 'Escape' && this.state.steps) { this.setState({ steps: false }); return; }
      if (e.key === 'Escape') { if (this.state.inv) this.closeInvite(); else if (this.state.calcOpen) this.closeCalc(); else this.leave('index.html'); return; }
      if (this.state.calcOpen || this.state.inv || this.state.steps) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); this.togglePlay(); return; }       // Space = play / pause, like any player
      if (['ArrowDown', 'PageDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); this.go(1); }
      else if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); this.go(-1); }
    };
    r.addEventListener('wheel', this.onWheel, { passive: false });
    r.addEventListener('touchstart', this.onTS, { passive: true });
    r.addEventListener('touchmove', this.onTM, { passive: true });
    r.addEventListener('touchend', this.onTE, { passive: true }); r.addEventListener('touchcancel', this.onTE, { passive: true });
    addEventListener('keydown', this.onKey);
    // the caption card is as tall as its longest caption needs on THIS screen (+ the player), so no step ever runs into the
    // controls; the last step (with its button) gets its own height
    this.sizeCard = () => {
      const card = r.querySelector('.xpl-card'), foot = r.querySelector('.xpl-foot'), caps = [...r.querySelectorAll('[data-cap]')]; if (!card || !foot || !caps.length) return;
      const need = c => { const k = [...c.children]; return k.reduce((a, e) => a + e.getBoundingClientRect().height, 0) + 8 * Math.max(0, k.length - 1); };
      const chrome = 22 + 16 + foot.getBoundingClientRect().height + 8;
      card.style.setProperty('--ch', Math.ceil(Math.max(...caps.slice(0, -1).map(need)) + chrome) + 'px');
      card.style.setProperty('--chl', Math.ceil(need(caps[caps.length - 1]) + chrome + 6) + 'px');
    };
    this.sizeCard(); ready.then(() => this.sizeCard());
    this.onFit = () => { this.fitPoster(); this.sizeCard(); }; addEventListener('resize', this.onFit); this.fitPoster();
    this.onShow = () => { if (this.state.wpOpening) this.setState({ wpOpening: false }); }; addEventListener('pageshow', this.onShow);
    // browsers keep a page silent until its first touch: that touch (anywhere) unlocks the voice and plays the waiting line
    this.onUnlock = () => this.unlock();
    ['pointerup', 'touchend', 'keydown', 'click'].forEach(ev => addEventListener(ev, this.onUnlock, true));
    this.onVis = () => { if (document.hidden) { clearTimeout(this.sayT); this.hush(); } };
    document.addEventListener('visibilitychange', this.onVis);
    V.prefetch(); this.voiceInit();
    // the axes draw themselves as the veil lifts (fonts + first paint in)
    ready.then(() => setTimeout(() => { if (this.s < 0 && !this.dead) this.go(1); }, this.props.embedded ? 0 : 150));   // opened over the landing: start at once
  }
  componentWillUnmount() {
    this.dead = true;
    const r = this.root.current;
    if (r) { r.removeEventListener('wheel', this.onWheel); r.removeEventListener('touchstart', this.onTS); r.removeEventListener('touchmove', this.onTM); r.removeEventListener('touchend', this.onTE); r.removeEventListener('touchcancel', this.onTE); }
    removeEventListener('keydown', this.onKey); removeEventListener('resize', this.onFit); removeEventListener('pageshow', this.onShow); clearTimeout(this.wpT);
    ['pointerup', 'touchend', 'keydown', 'click'].forEach(ev => removeEventListener(ev, this.onUnlock, true));
    document.removeEventListener('visibilitychange', this.onVis);
    clearTimeout(this.sayT); this.hush(); this.pending = null;
    if (this.props.embedded) delete document.documentElement.dataset.step;
  }
  // ── the voice ────────────────────────────────────────────────────────────────────────────────
  /** Web Audio: the recording is decoded once, each step plays exactly its segment with real fades (iOS ignores
   *  <audio>.volume, so fades there would click), and `audioSession = playback` keeps it audible with the iPhone's
   *  silent switch on. If Web Audio can't decode it, a plain <audio> element plays the segments instead. */
  voiceInit() {
    const fallback = () => { if (this.dead || this.el) return; const a = new Audio(VOICE_URL); a.preload = 'auto'; a.playsInline = true; this.el = a; if (this.pending != null && this.unlocked) { const i = this.pending; this.pending = null; this.say(i); } };
    this.ctx = V.makeCtx();
    if (!this.ctx) { fallback(); return; }
    // the tap that opened the lesson (on the landing) already woke the audio; otherwise try — browsers that allow sound will
    if (V.unlocked || this.ctx.state === 'running') this.unlocked = true; else { try { this.ctx.resume().then(() => { if (this.ctx.state === 'running' && !this.unlocked) { this.unlocked = true; if (this.pending != null) { const i = this.pending; this.pending = null; this.say(i); } if (this.state.waiting) this.setState({ waiting: false }); } }, () => {}); } catch (e) {} }
    V.decode().then(buf => { if (this.dead) return; this.buf = buf; if (this.pending != null && this.unlocked) { const i = this.pending; this.pending = null; this.say(i); } })
      .catch(err => { console.warn('voice', err); fallback(); });
  }
  /** the first touch / key: wake the audio (a silent blip is what iOS needs), then speak the line that was waiting */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.ctx) V.unlock();
    if (this.pending != null && this.state.voiceOn) { this.tapToListen = performance.now(); const i = this.pending; this.pending = null; this.say(i); }
    if (this.state.waiting) this.setState({ waiting: false });
  }
  say(i) {
    if (!this.state.voiceOn || this.state.paused || this.dead || this.leaving || this.state.inv || i < 0 || i >= SEG.length || i !== this.s) return;
    const ua = navigator.userActivation;
    if (!this.unlocked && !V.unlocked && !(ua && ua.hasBeenActive) && !(this.ctx && this.ctx.state === 'running')) { this.pending = i; if (!this.state.waiting) this.setState({ waiting: true }); return; }
    if (this.ctx && !this.buf && !this.el) { this.pending = i; return; }          // still decoding: speaks as soon as it's ready
    this.hush(); this.lineDone = -1;
    const [t0, t1] = SEG[i], off = Math.max(0, t0 - .06), dur = t1 + FADE_OUT - off;
    if (this.buf) {
      const ctx = this.ctx, go = () => {
        if (i !== this.s || !this.state.voiceOn || this.state.inv || this.leaving) return;
        const src = ctx.createBufferSource(), g = ctx.createGain(), now = ctx.currentTime;
        src.buffer = this.buf; src.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + FADE_IN);
        g.gain.setValueAtTime(1, now + Math.max(FADE_IN, dur - FADE_OUT)); g.gain.linearRampToValueAtTime(0, now + dur);
        src.start(now, off, dur);
        const me = { src, g }; this.cur = me;
        src.onended = () => { if (this.cur !== me) return; this.cur = null; this.lineDone = i; this.ended(i); };
        this.setState({ speaking: true, waiting: false });
      };
      if (ctx.state !== 'running') ctx.resume().then(go, () => { this.pending = i; this.setState({ waiting: true }); }); else go();
      return;
    }
    const a = this.el; if (!a) return;
    try { a.currentTime = off; } catch (e) {}
    a.play().then(() => {
      const me = { a }; this.cur = me; this.setState({ speaking: true, waiting: false });
      const tick = () => { if (this.cur !== me) return; if (this.state.paused) { this.vRaf = requestAnimationFrame(tick); return; } if (a.paused || a.currentTime >= t1 + FADE_OUT) { a.pause(); this.cur = null; this.ended(i); return; } this.vRaf = requestAnimationFrame(tick); };
      this.vRaf = requestAnimationFrame(tick);
    }).catch(err => { if (err && err.name === 'NotAllowedError') { this.unlocked = false; this.pending = i; this.setState({ waiting: true }); } });
  }
  /** a line finished by itself: after a beat (and once the pen is done) the lesson moves on — not past the last step */
  ended(i) {
    this.setState({ speaking: false });
    clearTimeout(this.autoT);
    if (i !== this.s || i >= this.N - 1 || !this.state.voiceOn || this.state.paused) return;
    const wait = Math.max(PAUSE, (this.drawEnd || 0) - performance.now() + 250);
    this.autoT = setTimeout(() => { if (this.s === i && this.state.voiceOn && !this.state.paused && !this.cur && !document.hidden) this.go(1); }, wait);
  }
  /** stop whatever is speaking — quickly faded, never clipped — and cancel the auto-advance */
  hush() {
    clearTimeout(this.autoT); cancelAnimationFrame(this.vRaf);
    const c = this.cur; this.cur = null;
    if (c && c.src) { try { const now = this.ctx.currentTime; c.g.gain.cancelScheduledValues(now); c.g.gain.setValueAtTime(c.g.gain.value, now); c.g.gain.linearRampToValueAtTime(0, now + .06); c.src.stop(now + .07); } catch (e) {} }
    if (c && c.a) { try { c.a.pause(); } catch (e) {} }
    if (c && c.src && this.ctx && this.ctx.state === 'suspended' && !this.state.paused) { try { this.ctx.resume(); } catch (e) {} }
    if (this.state.speaking) this.setState({ speaking: false });
  }
  /** let a paused (suspended) audio clock run again — used when the paused line is dropped */
  wake() { const c = this.cur; if (c && c.src && this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} } }
  /** play / pause: pause freezes the narration mid-word (the audio clock stops) and holds the step; play carries on from
   *  exactly there — or speaks this step's line if it never started (a step chosen while paused) — and, if the line had
   *  already finished, moves on as it would have */
  togglePlay() {
    if (this.tapToListen && performance.now() - this.tapToListen < 700) return;   // that tap just started the voice ("Tap to listen")
    if (!this.state.voiceOn) { store.set(VOICE_KEY, '1'); this.unlocked = true; this.setState({ voiceOn: true, paused: false }, () => this.say(this.s)); return; }
    const c = this.cur;
    if (!this.state.paused) {
      clearTimeout(this.sayT); clearTimeout(this.autoT);
      if (c && c.src) { try { this.ctx.suspend(); } catch (e) {} }
      if (c && c.a) { try { c.a.pause(); } catch (e) {} }
      this.setState({ paused: true });
      return;
    }
    this.unlocked = true;
    this.setState({ paused: false }, () => {
      if (c && c.src) { try { this.ctx.resume(); } catch (e) {} return; }
      if (c && c.a) { c.a.play().catch(() => {}); return; }
      if (this.lineDone === this.s) this.ended(this.s); else this.say(this.s);
    });
  }
  toggleVoice(e) {
    e.preventDefault(); e.stopPropagation();
    if (this.tapToListen && performance.now() - this.tapToListen < 700) return;   // that tap was "Tap to listen": keep listening
    const on = !this.state.voiceOn; store.set(VOICE_KEY, on ? '1' : '0');
    if (!on) { clearTimeout(this.sayT); this.hush(); this.pending = null; this.setState({ voiceOn: false, waiting: false }); return; }
    this.unlocked = true; this.setState({ voiceOn: true }, () => this.say(this.s));
  }
  // ── the invite: our private WhatsApp group, after the lesson ────────────────────────────────────
  openInvite() {
    if (this.leaving) return;
    clearTimeout(this.sayT); this.hush(); this.pending = null;
    try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
    this.setState({ inv: true, waiting: false });
  }
  closeInvite() { this.setState({ inv: false }); }
  /** the poster's 1080 × 1920 stage, scaled to fit the screen and centred */
  fitPoster() {
    const el = this.wpRef.current; if (!el) return;
    const W = innerWidth, H = innerHeight, k = Math.min(W / 1080, H / 1920);
    el.style.transform = 'translate(' + ((W - 1080 * k) / 2).toFixed(1) + 'px,' + ((H - 1920 * k) / 2).toFixed(1) + 'px) scale(' + k.toFixed(5) + ')';
  }
  componentDidUpdate() { const on = !!this.state.inv; if (on && !this.wasInv) this.fitPoster(); this.wasInv = on; }   // (the runtime passes no previous state)
  /** Into the ONE calculator (the landing's #calculator): the calculator's ink grows as a circle from the control that was
   *  tapped, the lesson eases back underneath, and the landing opens on the calculator as the ink lifts. */
  openCalc(e) {
    if (this.props.embedded && this.props.onCalc) { clearTimeout(this.sayT); this.hush(); this.pending = null; this.props.onCalc(); return; }
    if (this.leaving) return; this.leaving = true;
    if (this.state.inv) { const iv = document.querySelector('.xinv'); if (iv) iv.style.pointerEvents = 'none'; }
    const el = e && e.currentTarget, b = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const r = this.root.current; if (r) r.classList.add('away');
    clearTimeout(this.sayT); this.hush(); this.pending = null;
    try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
    const o = { style: 'ink', x: b ? Math.round(b.right - Math.min(26, b.width / 2)) : innerWidth / 2, y: b ? Math.round(b.top + b.height / 2) : innerHeight / 2, kicker: 'The calculator', title: 'See it with your money' };
    if (window.tdcVeil) window.tdcVeil.go('index.html#calculator', o); else location.href = 'index.html#calculator';
  }
  closeCalc() {
    if (!this.state.calcOpen) return;
    this.setState({ calcOpen: false });
    delete document.documentElement.dataset.calc;
  }
  leave(url) {
    if (this.props.embedded && url === 'index.html' && this.props.onClose) { clearTimeout(this.sayT); this.hush(); this.pending = null; this.props.onClose(); return; }
    if (this.leaving) return; this.leaving = true;
    clearTimeout(this.sayT); this.hush(); this.pending = null;
    if (window.tdcVeil) window.tdcVeil.go(url, { style: 'sky', fast: true }); else location.href = url;
  }
  renderVals() {
    const S = this.state, open = S.calcOpen, on = S.voiceOn, waiting = on && S.waiting && !S.speaking, now = S.stepNow < 0 ? 0 : S.stepNow, playing = on && !S.paused;
    const jump = n => { if (this.go && n !== this.s) this.go(n - this.s); };
    return {
      // the player
      prevStep: e => { e.stopPropagation(); this.go && this.go(-1); }, nextStep: e => { e.stopPropagation(); this.go && this.go(1); },
      togglePlay: e => { e.stopPropagation(); this.togglePlay(); },
      atStart: now <= 0, atEnd: now >= this.N - 1,
      playCls: 'play' + (playing ? '' : ' paused'), showPause: playing, showPlay: !playing, playAria: playing ? 'Pause the voice-over' : 'Play the voice-over',
      progTap: e => { e.stopPropagation(); const d = e.target.closest && e.target.closest('[data-dot]'); if (d) jump(+d.dataset.dot); },
      openSteps: e => { e.stopPropagation(); this.setState({ steps: true }); }, closeSteps: () => this.setState({ steps: false }),
      stCls: 'xst' + (S.steps ? ' open' : ''), stHidden: S.steps ? 'false' : 'true', stInert: !S.steps,
      stSub: `Step ${now + 1} of ${this.N} · tap any to jump`,
      stepRows: STEPS.map(([k, h], i) => ({ n: i + 1, k, h, on: i === now, cls: 'xst-row' + (i === now ? ' on' : i <= (this.maxSeen || 0) ? ' seen' : ''), pick: () => { this.setState({ steps: false }); jump(i); } })),
      // the Voice pill
      toggleVoice: e => this.toggleVoice(e), voiceOnS: on ? 'true' : 'false',
      vCls: 'xpl-pill xpl-voice' + (on ? '' : ' off') + (waiting ? ' wait' : ''), vAria: !on ? 'Turn the voice-over on' : waiting ? 'Tap to listen to the voice-over' : 'Turn the voice-over off',
      vBars: on && S.speaking && !S.paused && !reducedMotion, vIdle: on && !(S.speaking && !S.paused && !reducedMotion), vOff: !on, vText: waiting ? 'Tap to listen' : 'Voice',
      // the invite
      invCls: 'xinv' + (S.inv ? ' open' : ''), invHidden: S.inv ? 'false' : 'true', invInert: !S.inv, joined: S.joined, notJoined: !S.joined,
      invBack: () => this.closeInvite(),
      // join: the link opens in this tab (that's what hands it to the WhatsApp app); remembered, so next time Skip goes straight on
      join: e => { e && e.stopPropagation && e.stopPropagation(); store.set(JOINED_KEY, '1'); try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} this.setState({ wpOpening: true }); clearTimeout(this.wpT); this.wpT = setTimeout(() => { if (!this.dead) this.setState({ wpOpening: false, joined: true }); }, 2500); },
      posterTap: e => { if (e.target.closest && e.target.closest('a,button')) return; const a = this.wpRef.current && this.wpRef.current.querySelector('.xwp-btn'); if (a) a.click(); },
      wpBtnCls: 'xwp-btn' + (S.wpOpening ? ' pressed' : ''), wpLabel: S.wpOpening ? 'Opening WhatsApp…' : 'Join on WhatsApp',
      joinAgain: () => {},
      later: e => { e && e.stopPropagation && e.stopPropagation(); this.openCalc(e); },
      root: this.root, svgRef: this.svgRef, wpRef: this.wpRef,
      lessonCls: 'xpl-lesson' + (open ? ' away' : ''), calcCls: 'xpl-calc' + (open ? ' open' : ''),
      calcOpen: open, calcHidden: open ? 'false' : 'true', calcMounted: this.state.calcMounted,
      // a tap moves one step on — except the tap that just woke the voice ("Tap to listen"), which only starts it
      next: () => { if (this.tapToListen && performance.now() - this.tapToListen < 700) return; this.go && this.go(1); },
      goHome: e => { e.preventDefault(); e.stopPropagation(); this.leave('index.html'); },
      // Skip / "See it with your money": the invite first — unless they've already tapped Join
      goCalc: e => { e.preventDefault(); e.stopPropagation(); if (this.state.joined) this.openCalc(e); else this.openInvite(); },
      closeCalc: () => this.closeCalc(),
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"class": "xpl"}, h("div", {"ref": R(v," root "), "class": R(v," lessonCls "), "inert": R(v," calcOpen ")}, h("div", {"class": "xpl-grid"}), h("div", {"class": "xpl-col"}, h("div", {"class": "xpl-head"}, h("a", {"href": "index.html", "onClick": R(v," goHome "), "aria-label": "Back to TheDigiCiti", "class": "xpl-pill xpl-back"}, h("i", {}, h("svg", {"width": "15", "height": "15", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M19 12H5M11 6l-6 6 6 6"}))), h("span", {}, "TheDigiCiti")), h("div", {"class": "xpl-right"}, h("button", {"type": "button", "onClick": R(v," toggleVoice "), "class": R(v," vCls "), "aria-pressed": R(v," voiceOnS "), "aria-label": R(v," vAria "), "data-voice": "1"}, h("span", {"class": "ic", "aria-hidden": "true"}, (R(v," vBars ") ? [h("span", {"class": "bar"}), h("span", {"class": "bar"}), h("span", {"class": "bar"}), h("span", {"class": "bar"})] : null), (R(v," vIdle ") ? [h("svg", {"width": "18", "height": "16", "viewBox": "0 0 24 22", "fill": "none", "stroke": "#f6c445", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M3 8v6h4l5 4V4L7 8H3z", "fill": "#f6c445"}), h("path", {"d": "M16 7.5a5 5 0 010 7M19 4.5a9 9 0 010 13"}))] : null), (R(v," vOff ") ? [h("svg", {"width": "18", "height": "16", "viewBox": "0 0 24 22", "fill": "none", "stroke": "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M3 8v6h4l5 4V4L7 8H3z"}), h("path", {"d": "M17 8l5 6M22 8l-5 6"}))] : null)), h("span", {}, ...T(v,["", " vText ", ""]))), h("button", {"type": "button", "onClick": R(v," goCalc "), "class": "xpl-pill xpl-skip"}, "Skip"))), h("div", {"class": "xpl-prog", "onClick": R(v," progTap "), "role": "tablist", "aria-label": "Steps — tap one to jump to it"}, h("span", {"data-dot": "0"}), h("span", {"data-dot": "1"}), h("span", {"data-dot": "2"}), h("span", {"data-dot": "3"}), h("span", {"data-dot": "4"}), h("span", {"data-dot": "5"}), h("span", {"data-dot": "6"}), h("span", {"data-dot": "7"}), h("span", {"data-dot": "8"})), h("div", {"class": "xpl-graph", "onClick": R(v," next ")}, h("svg", {"ref": R(v," svgRef "), "class": "xpl-svg", "viewBox": "0 0 360 360", "aria-hidden": "true"}, h("defs", {}, h("linearGradient", {"id": "xlg", "gradientUnits": "userSpaceOnUse", "x1": "126", "y1": "246", "x2": "252", "y2": "108"}, h("stop", {"offset": "0", "stop-color": "#8fd65a"}), h("stop", {"offset": ".5", "stop-color": "#f6c445"}), h("stop", {"offset": "1", "stop-color": "#e2725b"})), h("radialGradient", {"id": "xgG"}, h("stop", {"offset": "0", "stop-color": "#8fd65a", "stop-opacity": ".6"}), h("stop", {"offset": ".5", "stop-color": "#8fd65a", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#8fd65a", "stop-opacity": "0"})), h("radialGradient", {"id": "xgR"}, h("stop", {"offset": "0", "stop-color": "#e2725b", "stop-opacity": ".65"}), h("stop", {"offset": ".5", "stop-color": "#e2725b", "stop-opacity": ".3"}), h("stop", {"offset": "1", "stop-color": "#e2725b", "stop-opacity": "0"})), h("radialGradient", {"id": "xgY"}, h("stop", {"offset": "0", "stop-color": "#f6c445", "stop-opacity": ".42"}), h("stop", {"offset": ".55", "stop-color": "#f6c445", "stop-opacity": ".14"}), h("stop", {"offset": "1", "stop-color": "#f6c445", "stop-opacity": "0"})), h("radialGradient", {"id": "xhG"}, h("stop", {"offset": "0", "stop-color": "#8fd65a", "stop-opacity": ".75"}), h("stop", {"offset": ".45", "stop-color": "#8fd65a", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#8fd65a", "stop-opacity": "0"})), h("radialGradient", {"id": "xhY"}, h("stop", {"offset": "0", "stop-color": "#f6c445", "stop-opacity": ".75"}), h("stop", {"offset": ".45", "stop-color": "#f6c445", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#f6c445", "stop-opacity": "0"})), h("radialGradient", {"id": "xhR"}, h("stop", {"offset": "0", "stop-color": "#e2725b", "stop-opacity": ".75"}), h("stop", {"offset": ".45", "stop-color": "#e2725b", "stop-opacity": ".28"}), h("stop", {"offset": "1", "stop-color": "#e2725b", "stop-opacity": "0"}))), h("g", {"data-dim": "1"}, h("ellipse", {"data-in": "5", "data-out": "6", "cx": "96", "cy": "268", "rx": "64", "ry": "38", "fill": "url(#xgG)"}), h("ellipse", {"data-in": "6", "data-out": "7", "cx": "282", "cy": "74", "rx": "64", "ry": "38", "fill": "url(#xgR)"}), h("g", {"data-sk": "1", "fill": "none", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"class": "pen", "data-in": "0", "data-draw": "1.6", "d": "M44 318 C43 250 45 170 43.5 100 C43 70 44.5 46 44 28", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "0", "data-draw": ".5", "data-delay": "1.5", "d": "M33 44 L44 26 L55 44", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "0", "data-draw": "1.6", "data-delay": "1.9", "d": "M44 318 C110 317 190 319.5 260 318 C295 317.5 318 318.5 338 318", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "0", "data-draw": ".5", "data-delay": "3.4", "d": "M322 307 L340 318 L322 329", "pathLength": "1", "stroke": "#fff6ea", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "1", "data-out": "2", "data-draw": ".9", "d": "M66 214 L66 146 M57 160 L66 144 L75 160", "pathLength": "1", "stroke": "#f6c445", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "1", "data-out": "2", "data-draw": ".9", "data-delay": ".5", "d": "M184 296 L254 296 M240 287 L256 296 L240 305", "pathLength": "1", "stroke": "#f6c445", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "2", "data-out": "3", "data-draw": "2.8", "data-delay": ".2", "d": "M62 46 C100 43 140 45 172 44 C174 70 173 96 174 122 C136 124 98 122 62 123 C60 96 63 70 62.5 48", "pathLength": "1", "stroke": "#f6c445", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "3", "data-draw": "2.4", "data-delay": ".1", "d": "M58 288 C44 288 42 268 58 264 C56 248 76 242 86 252 C92 238 116 238 120 254 C134 248 146 262 136 272 C148 280 138 294 124 290 C112 298 72 298 58 288 Z", "pathLength": "1", "stroke": "#8fd65a", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "3", "data-draw": "2.4", "data-delay": ".7", "d": "M244 94 C230 94 228 74 244 70 C242 54 262 48 272 58 C278 44 302 44 306 60 C320 54 332 68 322 78 C334 86 324 100 310 96 C298 104 258 104 244 94 Z", "pathLength": "1", "stroke": "#e2725b", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "6", "data-out": "7", "data-draw": "1.8", "data-delay": ".2", "d": "M236 124 L250 114 L262 146 L274 132 L290 198 M281 186 L290 200 L298 187", "pathLength": "1", "stroke": "#e2725b", "stroke-width": "2.6"}), h("path", {"class": "pen", "data-in": "7", "data-draw": "2.6", "data-delay": ".3", "d": "M126 246 Q172 196 252 108", "pathLength": "1", "stroke": "url(#xlg)", "stroke-width": "3.4"})), h("g", {}, h("text", {"data-in": "1", "x": "26", "y": "180", "text-anchor": "middle", "transform": "rotate(-90 26 180)", "font-size": "22", "fill": "#fff6ea"}, "Return"), h("text", {"data-in": "1", "x": "300", "y": "348", "text-anchor": "middle", "font-size": "22", "fill": "#fff6ea"}, "Risk"), h("text", {"data-in": "1", "data-out": "2", "x": "78", "y": "186", "font-size": "20", "fill": "#fbdb81"}, "more return"), h("text", {"data-in": "1", "data-out": "2", "x": "220", "y": "284", "text-anchor": "middle", "font-size": "20", "fill": "#fbdb81"}, "more risk"), h("text", {"data-in": "2", "data-out": "3", "x": "118", "y": "92", "text-anchor": "middle", "font-size": "28", "fill": "#fbdb81"}, "Ideal spot"), h("text", {"data-in": "3", "x": "96", "y": "277", "text-anchor": "middle", "font-size": "20", "fill": "#cdeec0"}, "Arbitrage"), h("text", {"data-in": "3", "x": "277", "y": "83", "text-anchor": "middle", "font-size": "15.5", "fill": "#ffd2c7"}, "Stocks & MFs"), h("text", {"data-in": "5", "data-out": "6", "x": "150", "y": "282", "font-size": "22", "fill": "#8fd65a"}, "≈5.5% a yr"), h("text", {"data-in": "6", "data-out": "7", "x": "300", "y": "214", "font-size": "22", "fill": "#e2725b"}, "−52%"), h("text", {"data-in": "8", "data-pop": "1", "x": "168", "y": "231", "font-size": "18", "fill": "#8fd65a"}, "Conservative"), h("text", {"data-in": "8", "data-pop": "1", "data-delay": ".4", "x": "199", "y": "197", "font-size": "18", "fill": "#f6c445"}, "Balanced"), h("text", {"data-in": "8", "data-pop": "1", "data-delay": ".8", "x": "231", "y": "163", "font-size": "18", "fill": "#e2725b"}, "Aggressive")), h("circle", {"data-in": "8", "data-pop": "1", "cx": "156.7", "cy": "212.6", "r": "20", "fill": "url(#xhG)"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".4", "cx": "186.9", "cy": "179.5", "r": "20", "fill": "url(#xhY)"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".8", "cx": "218.5", "cy": "144.9", "r": "20", "fill": "url(#xhR)"}), h("circle", {"data-in": "8", "data-pop": "1", "cx": "156.7", "cy": "212.6", "r": "7", "fill": "#8fd65a", "stroke": "#0b0c12", "stroke-width": "3"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".4", "cx": "186.9", "cy": "179.5", "r": "7", "fill": "#f6c445", "stroke": "#0b0c12", "stroke-width": "3"}), h("circle", {"data-in": "8", "data-pop": "1", "data-delay": ".8", "cx": "218.5", "cy": "144.9", "r": "7", "fill": "#e2725b", "stroke": "#0b0c12", "stroke-width": "3"})), h("ellipse", {"data-in": "4", "data-out": "5", "data-pop": "1", "cx": "190", "cy": "178", "rx": "122", "ry": "58", "fill": "url(#xgY)"}), h("text", {"data-in": "4", "data-out": "5", "data-pop": "1", "x": "190", "y": "200", "text-anchor": "middle", "font-size": "72", "fill": "#fbdb81"}, "₹1 Cr"))), h("div", {"class": "xpl-card", "onClick": R(v," next ")}, h("div", {"class": "xpl-caps"}, h("div", {"data-cap": "0", "class": "xpl-cap c0"}, h("span", {"class": "xpl-title"}, "Return & risk")), h("div", {"data-cap": "1", "class": "xpl-cap"}, h("span", {"class": "k"}, "How to read it"), h("span", {"class": "h"}, "Up means more return. Right means more risk.")), h("div", {"data-cap": "2", "class": "xpl-cap"}, h("span", {"class": "k"}, "The ideal spot"), h("span", {"class": "h"}, "High return, low risk."), h("span", {"class": "b"}, "Top left. Everyone wants to be here.")), h("div", {"data-cap": "3", "class": "xpl-cap"}, h("span", {"class": "k"}, "Where money goes"), h("span", {"class": "h"}, "Two real choices."), h("span", {"class": "list"}, h("span", {}, h("b", {"class": "g"}, "Arbitrage"), " · safe, but low return"), h("span", {}, h("b", {"class": "r"}, "Stocks & MFs"), " · high return, big swings"))), h("div", {"data-cap": "4", "class": "xpl-cap"}, h("span", {"class": "k red"}, "The problem"), h("span", {"class": "h big"}, "Say you have ₹1 crore."), h("span", {"class": "b"}, "Where do you put it?")), h("div", {"data-cap": "5", "class": "xpl-cap"}, h("span", {"class": "k grn"}, "Option one"), h("span", {"class": "h"}, "All of it in arbitrage?"), h("span", {"class": "tick"}, h("span", {}, h("b", {"class": "g"}, "✓"), "Your capital stays safe."), h("span", {}, h("b", {"class": "r"}, "✕"), "≈5.5% a year. Barely beats inflation."))), h("div", {"data-cap": "6", "class": "xpl-cap"}, h("span", {"class": "k red"}, "Option two"), h("span", {"class": "h"}, "All of it in stocks?"), h("span", {"class": "tick"}, h("span", {}, h("b", {"class": "g"}, "✓"), "Strong growth over the long run."), h("span", {}, h("b", {"class": "r"}, "✕"), "Some years it falls 50%. Could you hold on?"))), h("div", {"data-cap": "7", "class": "xpl-cap"}, h("span", {"class": "k"}, "How we solve it"), h("span", {"class": "h"}, "Not one or the other."), h("span", {"class": "b"}, "The line between them.")), h("div", {"data-cap": "8", "class": "xpl-cap"}, h("span", {"class": "k"}, "Your villas"), h("span", {"class": "h"}, "Three villas on that line."), h("span", {"class": "xpl-vkey", "aria-hidden": "true"}, h("span", {}, h("i", {"style": S("background:#8fd65a;box-shadow:0 0 8px rgba(143,214,90,.7)")}), "Conservative"), h("span", {}, h("i", {"style": S("background:#f6c445;box-shadow:0 0 8px rgba(246,196,69,.7)")}), "Balanced"), h("span", {}, h("i", {"style": S("background:#e2725b;box-shadow:0 0 8px rgba(226,114,91,.7)")}), "Aggressive")), h("a", {"href": "index.html#calculator", "onClick": R(v," goCalc "), "class": "xpl-cta"}, "See it with your money", h("i", {}, h("svg", {"width": "16", "height": "16", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M5 12h14M13 6l6 6-6 6"})))))), h("div", {"data-hint": "1", "class": "xpl-foot"}, h("div", {"class": "xpl-ctl"}, h("button", {"type": "button", "class": "nav", "onClick": R(v," prevStep "), "disabled": R(v," atStart "), "aria-label": "Previous step"}, h("svg", {"width": "16", "height": "16", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M15 6l-6 6 6 6"}))), h("button", {"type": "button", "class": R(v," playCls "), "onClick": R(v," togglePlay "), "aria-label": R(v," playAria "), "data-play": "1"}, (R(v," showPause ") ? [h("svg", {"width": "16", "height": "16", "viewBox": "0 0 24 24", "fill": "currentColor"}, h("rect", {"x": "6", "y": "5", "width": "4.2", "height": "14", "rx": "1.4"}), h("rect", {"x": "13.8", "y": "5", "width": "4.2", "height": "14", "rx": "1.4"}))] : null), (R(v," showPlay ") ? [h("svg", {"width": "18", "height": "18", "viewBox": "0 0 24 24", "fill": "currentColor"}, h("path", {"d": "M8 5.5v13a1 1 0 001.5.86l10.6-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"}))] : null)), h("button", {"type": "button", "class": "nav", "onClick": R(v," nextStep "), "disabled": R(v," atEnd "), "aria-label": "Next step"}, h("svg", {"width": "16", "height": "16", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M9 6l6 6-6 6"})))), h("button", {"type": "button", "class": "xpl-stepsb", "onClick": R(v," openSteps "), "aria-label": "All steps — jump to any"}, h("span", {"data-count": "1"}, "01 / 09"), h("svg", {"width": "12", "height": "12", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.6", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M6 15l6-6 6 6"}))))))), h("div", {"class": R(v," stCls "), "aria-hidden": R(v," stHidden "), "inert": R(v," stInert ")}, h("div", {"class": "xst-scrim", "onClick": R(v," closeSteps ")}), h("div", {"class": "xst-sheet", "role": "dialog", "aria-label": "All steps"}, h("span", {"class": "xst-grab"}), h("div", {"class": "xst-hd"}, h("div", {}, h("b", {}, "Return & risk"), h("span", {}, ...T(v,["", " stSub ", ""]))), h("button", {"type": "button", "class": "xst-x", "onClick": R(v," closeSteps "), "aria-label": "Close"}, h("svg", {"width": "14", "height": "14", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.4", "stroke-linecap": "round"}, h("path", {"d": "M6 6l12 12M18 6 6 18"})))), h("div", {"class": "xst-list"}, ...((L => Array.isArray(L) ? L : [])(R(v," stepRows ")).map((it, i) => (v => [h("button", {"type": "button", "class": R(v," st.cls "), "onClick": R(v," st.pick ")}, h("span", {"class": "xst-n"}, ...T(v,["", " st.n ", ""])), h("span", {"class": "xst-t"}, h("b", {}, ...T(v,["", " st.k ", ""])), h("span", {}, ...T(v,["", " st.h ", ""]))), (R(v," st.on ") ? [h("span", {"class": "xst-now"}, "Now")] : null))])({...v, "st": it, $index: i})))))), h("div", {"class": R(v," invCls "), "role": "dialog", "aria-modal": "true", "aria-label": "Join TheDigiCiti's WhatsApp group", "aria-hidden": R(v," invHidden "), "inert": R(v," invInert ")}, h("div", {"ref": R(v," wpRef "), "class": "xwp-stage", "onClick": R(v," posterTap ")}, h("div", {"class": "abs xwp-stars"}), h("div", {"class": "abs xwp-halo"}), h("div", {"class": "abs xwp-ring o"}), h("div", {"class": "abs xwp-ring i"}), h("div", {"class": "abs xwp-ping", "aria-hidden": "true"}), h("div", {"class": "abs xwp-brand"}, h("span", {}, "TheDigi", h("span", {"class": "serif"}, "Citi"))), h("div", {"class": "abs xwp-head"}, h("h2", {}, "Join the", h("br", {}), h("span", {"class": "serif"}, "inner circle."))), h("div", {"class": "abs xwp-hero", "aria-hidden": "true"}, h("div", {"class": "abs sh"}), h("div", {"class": "abs vg"}), h("div", {"class": "abs vs"}), h("img", {"class": "abs villa", "src": "assets/whatsapp/villa.png", "alt": "", "decoding": "async"}), h("span", {"class": "abs badge"}, h("svg", {"width": "84", "height": "84", "viewBox": "0 0 24 24", "fill": "#fff"}, h("path", {"d": "M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"}))), h("span", {"class": "abs cg"}), h("img", {"class": "abs coin", "src": "assets/whatsapp/coin.png", "alt": "", "decoding": "async"})), h("div", {"class": "abs xwp-chips"}, h("span", {"class": "xwp-chip g"}, h("i", {}), "First to know"), h("span", {"class": "xwp-chip n"}, h("i", {}), "Ask the team")), h("div", {"class": "abs xwp-cta"}, h("div", {"class": "xwp-cue", "aria-hidden": "true"}, h("svg", {"width": "120", "height": "84", "viewBox": "0 0 120 84", "fill": "none", "stroke": "#5ee08f", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M6 10 C46 4 92 18 104 66"}), h("path", {"d": "M88 58 L104 70 L114 52"})), h("b", {}, "TAP TO JOIN"), h("svg", {"width": "120", "height": "84", "viewBox": "0 0 120 84", "fill": "none", "stroke": "#5ee08f", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M114 10 C74 4 28 18 16 66"}), h("path", {"d": "M32 58 L16 70 L6 52"}))), h("a", {"class": R(v," wpBtnCls "), "href": "https://chat.whatsapp.com/CkLA7YfcfOaG1i92miDbbw?mode=gi_t", "onClick": R(v," join "), "aria-label": "Join TheDigiCiti's group on WhatsApp"}, h("svg", {"width": "66", "height": "66", "viewBox": "0 0 24 24", "fill": "#0b2a17", "aria-hidden": "true"}, h("path", {"d": "M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"})), h("b", {}, ...T(v,["", " wpLabel ", ""]))), h("span", {"class": "xwp-fine"}, "Free · No spam · Leave any time"), h("button", {"type": "button", "class": "xwp-later", "onClick": R(v," later ")}, "Not now — show me the calculator", h("svg", {"width": "30", "height": "30", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M5 12h14M13 6l6 6-6 6"}))))), h("button", {"type": "button", "onClick": R(v," invBack "), "class": "xpl-pill xpl-back xwp-back", "aria-label": "Back to the lesson"}, h("i", {}, h("svg", {"width": "15", "height": "15", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M19 12H5M11 6l-6 6 6 6"}))), h("span", {}, "Lesson"))))]; }
export const HELMET = [{"tag": "title", "attrs": {}, "text": "TheDigiCiti — Return & risk"}, {"tag": "meta", "attrs": {"name": "viewport", "content": "width=device-width, initial-scale=1, viewport-fit=cover"}, "text": ""}, {"tag": "style", "attrs": {"data-ds": ""}, "text": ":root{--night-0:#0b0c12;--night-1:#161826;--night-2:#171925;--night-3:#1e2130;--night-4:#242739;--night-5:#2c2f42;--night-6:#3a3d52;--ink-1:#ececf1;--ink-2:#a3a5b4;--ink-3:#7a7c8c;--ink-4:#4d4f5e;--violet-900:#2b2741;--violet-700:#4a4380;--violet-500:#7f72e0;--violet-300:#b5abfc;--violet-200:#d4cdfd;--violet-50:#f1effd;--grass-900:#1f4a13;--grass-800:#2a5a1c;--grass-700:#3f7e21;--grass-600:#4a9d47;--grass-500:#5cb85c;--grass-400:#6cba36;--grass-300:#8fd65a;--grass-200:#8fd48a;--grass-100:#b4e394;--grass-50:#e6f6d6;--gold-900:#2a261c;--gold-500:#f6c445;--gold-400:#e9c15c;--gold-300:#fbdb81;--gold-200:#f3e2a9;--sage-400:#8aa89b;--sage-300:#8fb7b0;--coral-500:#e2725b;--coral-400:#ec8a73;--slate-300:#8a8ea3;--slate-500:#666a7d;--slate-700:#313440;--slate-800:#20222d;--deck-cream:#f2ece0;--deck-cream-2:#fbf7ea;--deck-forest:#2f4034;--deck-forest-deep:#22312a;--deck-moss:#3f6b45;--deck-pine:#2f5537;--deck-sage:#7fa383;--deck-sage-2:#7fb37a;--deck-mute:#5d6b5f;--deck-line:#c5cdbf;--deck-gold:#e0b13f;--deck-brick:#a3322b;--bg-app:var(--night-1);--bg-tool:var(--night-0);--surface-card:var(--night-3);--surface-card-2:var(--night-2);--surface-raised:#24273a;--border-hairline:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);--text-primary:var(--ink-1);--text-secondary:var(--ink-2);--text-muted:var(--ink-3);--text-faint:var(--ink-4);--accent:var(--violet-300);--accent-fill:var(--violet-900);--positive:var(--grass-300);--negative:var(--coral-500);--income:var(--gold-500);--risk-low:var(--grass-300);--risk-medium:var(--gold-500);--risk-high:var(--coral-500);--asset-arbitrage:var(--sage-400);--asset-gold:var(--gold-500);--asset-large:var(--grass-600);--asset-mid:var(--grass-500);--asset-small:var(--grass-200);}"}, {"tag": "script", "attrs": {"src": "part-transitions.js"}, "text": ""}, {"tag": "script", "attrs": {}, "text": "window.tdcVeil && window.tdcVeil.prefetch([\"index.html\"]);"}, {"tag": "style", "attrs": {}, "text": "\n/* ── EXPLORE (phones) · the \"Return & risk\" lesson, 9 steps, then the calculator full-screen ────\n   Ported from the explore-flow handoff (Story Mobile.html). Same look and timing; built to stay\n   smooth on any phone: the hand-drawn look is BAKED into the path data once at mount (no SVG\n   displacement filter re-rendering while the pen draws), glows are radial gradients (no Gaussian\n   blur, no drop-shadows), nothing uses backdrop-filter, every move is opacity/transform or a\n   stroke-dashoffset draw. One tap or one swipe = one step; the card and the graph both advance.\n   NARRATED: one recorded voice (assets/voice/lesson.mp3, one segment per step) — the pen leads, the voice follows 220 ms\n   later, and when a line ends the lesson moves on by itself; any touch takes over. Played through Web Audio (sample-exact\n   segments, click-free fades, and it still speaks with the iPhone's silent switch on); the Voice pill turns it off.\n   Step 9's CTA (or Skip) opens the INVITE: our private WhatsApp group, one tap to join — or straight on to THE calculator\n   (the landing's #calculator — there is only one). Someone who has tapped Join goes straight to the calculator next time. */\nhtml,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:#0b0c12}\n.xpl{position:fixed;inset:0;overflow:hidden;color:#fff6ea;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;background:radial-gradient(ellipse 70% 40% at 50% 34%,rgba(246,196,69,.12),transparent 70%),radial-gradient(ellipse 80% 30% at 50% 100%,rgba(42,43,107,.55),transparent 70%),linear-gradient(180deg,#0c0e24,#0a0b16)}\n.xpl *{box-sizing:border-box}\n.xpl-lesson{position:absolute;inset:0;touch-action:none;transition:transform .55s cubic-bezier(.2,.8,.2,1),opacity .45s ease;will-change:transform}\n.xpl-lesson.away{transform:scale(.96);opacity:.6;pointer-events:none}\n.xpl-grid{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,236,190,.14) 1px,transparent 1.2px);background-size:24px 24px;-webkit-mask-image:radial-gradient(ellipse 80% 55% at 50% 38%,#000 35%,transparent 95%);mask-image:radial-gradient(ellipse 80% 55% at 50% 38%,#000 35%,transparent 95%)}\n.xpl-col{position:relative;height:100%;max-width:480px;margin:0 auto;display:flex;flex-direction:column;padding:max(12px,env(safe-area-inset-top)) 16px max(14px,env(safe-area-inset-bottom))}\n.xpl-head{flex:none;display:flex;justify-content:space-between;align-items:center;gap:12px}\n.xpl-pill{display:flex;align-items:center;height:44px;border-radius:999px;border:0;font:inherit;cursor:pointer;color:#E1E0CC;text-decoration:none;-webkit-user-select:none;user-select:none}\n.xpl-back{gap:10px;padding:0 14px 0 5px;background:rgba(11,12,18,.62);box-shadow:inset 0 0 0 1px rgba(255,236,200,.18);font-size:14px;font-weight:600;letter-spacing:-.01em}\n.xpl-back i{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#E1E0CC;color:#0b0c12}\n.xpl-skip{padding:0 16px;background:transparent;font-size:13px;font-weight:500;color:rgba(225,224,204,.8);box-shadow:inset 0 0 0 1px rgba(225,224,204,.18)}\n/* the progress bar is also the chapter bar: every segment is a 24 px tall target that jumps to its step */\n.xpl-prog{flex:none;display:flex;gap:5px;margin-top:3px}\n.xpl-prog>span{flex:1;height:25px;padding:11px 0;background-clip:content-box;border-radius:2px;background-color:rgba(255,255,255,.12);cursor:pointer;transition:background-color .4s,transform .15s}\n.xpl-prog>span:active{transform:scaleY(1.6)}\n.xpl-prog>span.done{background-color:rgba(246,196,69,.45)}.xpl-prog>span.on{background-color:#f6c445}\n.xpl-graph{flex:1;min-height:0;position:relative;cursor:pointer}\n.xpl-svg{position:absolute;left:0;top:10px;width:100%;height:calc(100% - 20px);overflow:visible}\n.xpl-svg [data-in]{opacity:0}\n.xpl-svg .pen{stroke-dasharray:1;stroke-dashoffset:1}\n.xpl-svg [data-pop]{transform-box:fill-box;transform-origin:center;transform:scale(.4)}\n.xpl-svg [data-dim]{transition:opacity .6s ease}\n.xpl-svg text{font-family:Caveat,cursive;font-weight:700;pointer-events:none}\n.xpl-card{flex:none;position:relative;height:max(clamp(196px,28svh,214px),var(--ch,0px));transition:height .45s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;padding:22px 22px 16px;border-radius:26px;background:linear-gradient(180deg,rgba(255,244,222,.07),rgba(255,226,186,.03)),rgba(18,19,32,.9);box-shadow:inset 0 0 0 1px rgba(255,236,200,.14),0 30px 60px -30px rgba(0,0,0,.8);cursor:pointer;-webkit-user-select:none;user-select:none}\n.xpl-card.last{height:max(clamp(244px,34svh,264px),var(--chl,0px))}\n.xpl-caps{position:relative;flex:1}\n.xpl-cap{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;opacity:0;transform:translateY(14px);transition:opacity .4s ease,transform .5s cubic-bezier(.2,.8,.2,1);pointer-events:none}\n.xpl-cap.c0{justify-content:center;align-items:center}\n.xpl-cap.before{transform:translateY(-14px)}\n.xpl-cap.on{opacity:1;transform:none;pointer-events:auto}\n.xpl-cap .k{font-size:11px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:#f6c445}\n.xpl-cap .k.red{color:#e2725b}.xpl-cap .k.grn{color:#8fd65a}\n.xpl-cap .h{font-size:26px;font-weight:600;letter-spacing:-.035em;line-height:1.14;text-wrap:balance}\n.xpl-cap .h.big{font-size:30px;letter-spacing:-.04em;line-height:1.1}\n.xpl-cap .b{font-size:15px;line-height:1.45;color:rgba(255,246,234,.7)}\n.xpl-cap .list{display:flex;flex-direction:column;gap:5px;font-size:14.5px;line-height:1.35;color:rgba(255,246,234,.75)}\n.xpl-cap .list b{font-weight:600}.xpl-cap .g{color:#8fd65a}.xpl-cap .r{color:#e2725b}\n.xpl-cap .tick{display:flex;flex-direction:column;gap:5px;font-size:14.5px;line-height:1.35;color:#fff6ea}.xpl-cap .tick>span{display:flex;gap:10px}.xpl-cap .tick b{font-weight:600}\n.xpl-title{font-family:Caveat,cursive;font-size:34px;font-weight:700;color:#fbdb81}\n.xpl a.xpl-cta,.xpl-cta{margin-top:auto;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 6px 0 20px;border-radius:999px;border:0;font:inherit;cursor:pointer;background:#E1E0CC;color:#0b0c12;font-size:15px;font-weight:600;text-decoration:none;box-shadow:0 0 30px rgba(255,214,150,.35);animation:xplGlow 2.4s ease-in-out infinite}\n.xpl-cta i{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#0b0c12;color:#E1E0CC}\n.xpl-vkey{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;font-weight:500;color:rgba(255,246,234,.72)}.xpl-vkey>span{display:flex;align-items:center;gap:7px}.xpl-vkey i{width:8px;height:8px;border-radius:50%}\n.xpl-foot.gone{max-height:0;padding-top:0;opacity:0;overflow:hidden}\n/* the player: back · play/pause · next, and the step list */\n.xpl-ctl{display:flex;align-items:center;gap:8px}\n.xpl-ctl button,.xpl-stepsb{border:0;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .2s,opacity .2s}\n.xpl-ctl button:active,.xpl-stepsb:active{transform:scale(.92)}\n.xpl-ctl .nav{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#fff6ea;background:rgba(255,246,234,.07);box-shadow:inset 0 0 0 1px rgba(255,236,200,.14)}\n.xpl-ctl .nav:disabled{opacity:.3;cursor:default}\n.xpl-ctl .play{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:#0b0c12;background:#f6c445;box-shadow:0 0 20px -4px rgba(246,196,69,.7)}\n.xpl-ctl .play.paused{background:#fff6ea;box-shadow:0 0 0 4px rgba(255,246,234,.12)}\n.xpl-stepsb{display:flex;align-items:center;gap:7px;height:38px;padding:0 12px 0 14px;border-radius:999px;font-size:11px;letter-spacing:.2em;color:rgba(225,224,204,.75);background:rgba(255,246,234,.05);box-shadow:inset 0 0 0 1px rgba(255,236,200,.12)}\n.xpl-stepsb b{font-weight:600;color:#fff6ea}\n/* the step list: every step by name, one tap to jump */\n.xst{position:absolute;inset:0;z-index:25;visibility:hidden;transition:visibility 0s linear .45s}\n.xst.open{visibility:visible;transition:visibility 0s}\n.xst-scrim{position:absolute;inset:0;background:rgba(5,6,14,.6);opacity:0;transition:opacity .35s ease}\n.xst.open .xst-scrim{opacity:1}\n.xst-sheet{position:absolute;left:0;right:0;bottom:0;max-width:480px;margin:0 auto;max-height:84%;display:flex;flex-direction:column;padding:10px 10px max(14px,env(safe-area-inset-bottom));border-radius:28px 28px 0 0;background:linear-gradient(180deg,rgba(255,244,222,.06),rgba(255,226,186,.01) 30%),#13142a;box-shadow:inset 0 1px 0 rgba(255,236,200,.16),0 -30px 60px -10px rgba(0,0,0,.7);transform:translateY(105%);transition:transform .45s cubic-bezier(.2,.8,.2,1)}\n.xst.open .xst-sheet{transform:none}\n.xst-grab{align-self:center;width:40px;height:4px;border-radius:2px;background:rgba(225,224,204,.22)}\n.xst-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 12px 8px}\n.xst-hd b{font-size:20px;font-weight:600;letter-spacing:-.03em;color:#fff6ea}.xst-hd span{display:block;margin-top:2px;font-size:12.5px;color:rgba(225,224,204,.55)}\n.xst-x{width:38px;height:38px;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;background:rgba(255,246,234,.07);color:#E1E0CC}\n.xst-list{overflow:auto;display:flex;flex-direction:column;gap:2px;scrollbar-width:none;overscroll-behavior:contain}\n.xst-row{display:flex;align-items:center;gap:14px;min-height:56px;padding:6px 12px;border:0;border-radius:16px;text-align:left;cursor:pointer;font:inherit;color:#fff6ea;background:transparent;-webkit-tap-highlight-color:transparent}\n.xst-row:active{background:rgba(255,246,234,.06)}\n.xst-row.on{background:rgba(246,196,69,.1);box-shadow:inset 0 0 0 1px rgba(246,196,69,.35)}\n.xst-n{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:rgba(225,224,204,.7);box-shadow:inset 0 0 0 1.5px rgba(255,236,200,.2)}\n.xst-row.seen .xst-n{color:#0b0c12;background:rgba(246,196,69,.75);box-shadow:none}\n.xst-row.on .xst-n{color:#0b0c12;background:#f6c445;box-shadow:0 0 14px rgba(246,196,69,.6)}\n.xst-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}\n.xst-t b{font-size:15.5px;font-weight:600;letter-spacing:-.01em}.xst-t span{font-size:13px;color:rgba(225,224,204,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.xst-now{flex:none;font-size:10px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#f6c445}\n.xpl-foot{flex:none;display:flex;justify-content:space-between;align-items:center;padding-top:10px;max-height:56px;transition:opacity .3s,max-height .35s ease,padding .35s ease;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:rgba(225,224,204,.5)}\n.xpl-foot .sw{display:flex;align-items:center;gap:6px}\n.xpl-foot .sw svg{animation:xplBob 2.2s ease-in-out infinite}\n@keyframes xplBob{0%,100%{transform:translateY(1px)}50%{transform:translateY(-3px)}}\n@keyframes xplGlow{0%,100%{box-shadow:0 0 22px rgba(255,214,150,.28)}50%{box-shadow:0 0 36px rgba(255,214,150,.5)}}\n.xpl-calc{position:fixed;inset:0;z-index:20;--pvh:100%;background:#0b0c12;transform:translate3d(0,100%,0);visibility:hidden;will-change:transform;transition:transform .55s cubic-bezier(.2,.8,.2,1),visibility 0s linear .55s}\n.xpl-calc.open{transform:none;visibility:visible;transition:transform .55s cubic-bezier(.2,.8,.2,1),visibility 0s}\n.xpl-calc>.sc-host{height:100%}\n.xpl-right{display:flex;align-items:center;gap:8px}\n/* the Voice pill: gold bars while it speaks, a speaker when it's quiet, a crossed speaker when it's off */\n.xpl-voice{gap:8px;padding:0 15px 0 13px;background:rgba(11,12,18,.62);box-shadow:inset 0 0 0 1px rgba(255,236,200,.18);font-size:13px;font-weight:500;color:#fff6ea;transition:transform .15s,box-shadow .3s,color .3s}\n.xpl-voice:active{transform:scale(.96)}\n.xpl-voice.off{color:rgba(225,224,204,.6)}\n.xpl-voice.wait{box-shadow:inset 0 0 0 1px rgba(246,196,69,.75);animation:xplAsk 1.8s ease-in-out infinite}\n.xpl-voice .ic{position:relative;width:18px;height:16px;display:flex;align-items:center;justify-content:center;gap:2.5px}\n.xpl-voice .bar{width:3px;height:14px;border-radius:2px;background:#f6c445;transform:scaleY(.3);animation:xplBar .9s ease-in-out infinite}\n.xpl-voice .bar:nth-child(2){animation-delay:.15s}.xpl-voice .bar:nth-child(3){animation-delay:.3s}.xpl-voice .bar:nth-child(4){animation-delay:.45s}\n@keyframes xplBar{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}\n@keyframes xplAsk{0%,100%{box-shadow:inset 0 0 0 1px rgba(246,196,69,.75),0 0 0 0 rgba(246,196,69,0)}50%{box-shadow:inset 0 0 0 1px rgba(246,196,69,.95),0 0 22px 2px rgba(246,196,69,.35)}}\n@media (max-width:359px){.xpl-back{padding-right:5px}.xpl-back>span{display:none}.xpl-voice{padding:0 12px 0 11px}.xpl-skip{padding:0 13px}}\n/* ── the invite = the WhatsApp poster (TheDigiCiti-whatsapp-poster.zip, same as /whatsapp): a 1080×1920 stage scaled to fit ── */\n.xinv{position:fixed;inset:0;z-index:30;overflow:hidden;background:radial-gradient(ellipse 60% 120% at 50% 50%,transparent 40%,rgba(5,6,14,.75)),linear-gradient(180deg,#0c0f2c 0%,#2a2862 24%,#73467c 42%,#c8794f 54%,#3a2a4e 63%,#0c0e24 74%,#0a0b16 100%);visibility:hidden;opacity:0;transition:opacity .45s ease,visibility 0s linear .45s}\n@media (max-aspect-ratio:9/16){.xinv{background:linear-gradient(180deg,#0c0f2c 0 50%,#0a0b16 50% 100%)}}\n.xinv.open{visibility:visible;opacity:1;transition:opacity .45s ease,visibility 0s}\n.xwp-stage{position:absolute;left:0;top:0;width:1080px;height:1920px;overflow:hidden;transform-origin:0 0;cursor:pointer;font-family:Almarai,system-ui,-apple-system,sans-serif;color:#E1E0CC;background:linear-gradient(180deg,#0c0f2c 0%,#2a2862 24%,#73467c 42%,#c8794f 54%,#3a2a4e 63%,#0c0e24 74%,#0a0b16 100%)}\n.xwp-stage .abs{position:absolute}.xwp-stage .serif{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400}\n.xwp-stars{inset:0;pointer-events:none;opacity:.5;background-image:radial-gradient(rgba(255,236,190,.55) 1.2px,transparent 1.8px);background-size:46px 46px;-webkit-mask-image:linear-gradient(180deg,#000 0%,transparent 34%);mask-image:linear-gradient(180deg,#000 0%,transparent 34%)}\n.xwp-halo{left:60px;top:640px;width:960px;height:700px;border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(37,211,102,.30),rgba(251,219,129,.14) 55%,transparent)}\n.xwp-ring{border-radius:50%;pointer-events:none}.xwp-ring.o{left:190px;top:700px;width:700px;height:700px;box-shadow:inset 0 0 0 2px rgba(37,211,102,.22)}.xwp-ring.i{left:290px;top:800px;width:500px;height:500px;box-shadow:inset 0 0 0 2px rgba(37,211,102,.30)}\n.xwp-ping{left:290px;top:800px;width:500px;height:500px;border-radius:50%;pointer-events:none;box-shadow:inset 0 0 0 3px rgba(37,211,102,.5);opacity:0;animation:xwpPing 3.6s cubic-bezier(.2,.6,.3,1) 1.2s infinite}\n@keyframes xwpPing{0%{transform:scale(.8);opacity:0}15%{opacity:.9}100%{transform:scale(1.75);opacity:0}}\n.xwp-brand{left:72px;right:72px;top:120px;display:flex;justify-content:center}.xwp-brand>span{font-size:44px;font-weight:700;letter-spacing:-.045em;line-height:1;color:#fff6ea}.xwp-brand .serif{color:#fbdb81;letter-spacing:-.01em}\n.xwp-head{left:60px;right:60px;top:300px;display:flex;justify-content:center;text-align:center}\n.xwp-head h2{margin:0;font-size:132px;font-weight:400;line-height:.9;letter-spacing:-.065em;color:#fff6ea}.xwp-head .serif{color:#fbdb81;letter-spacing:-.02em}\n.xwp-hero{left:70px;top:640px;width:940px;height:740px;animation:xwpFloat 9s ease-in-out infinite}\n@keyframes xwpFloat{50%{transform:translateY(-7px)}}\n.xwp-hero .sh{left:10%;right:6%;bottom:2%;height:16%;border-radius:50%;background:radial-gradient(closest-side,rgba(6,7,16,.75),rgba(6,7,16,0))}\n.xwp-hero .vg{left:8%;right:8%;top:6%;bottom:14%;border-radius:50%;background:radial-gradient(closest-side,rgba(251,219,129,.34),rgba(251,219,129,.12) 55%,transparent)}\n.xwp-hero .vs{left:2%;right:16%;bottom:-2%;height:30%;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.5),transparent)}\n.xwp-hero .villa{inset:0;width:100%;height:100%;object-fit:contain}\n.xwp-hero .badge{right:14%;bottom:12%;z-index:2;width:150px;height:150px;border-radius:50%;display:grid;place-items:center;background:#25d366;box-shadow:0 0 0 12px #0c0e24,0 0 80px rgba(37,211,102,.7)}\n.xwp-hero .cg{left:41%;top:-9%;width:17.4%;aspect-ratio:1;border-radius:50%;background:radial-gradient(closest-side,rgba(255,200,90,.6),transparent)}\n.xwp-hero .coin{left:45.3%;top:-5%;width:9.4%;animation:xwpCoin 4s linear infinite}\n@keyframes xwpCoin{0%{transform:translateY(0) rotateY(0)}25%{transform:translateY(-9px) rotateY(90deg)}50%{transform:translateY(0) rotateY(180deg)}75%{transform:translateY(9px) rotateY(270deg)}100%{transform:translateY(0) rotateY(360deg)}}\n.xwp-chips{left:0;right:0;top:1372px;display:flex;justify-content:center;gap:14px}\n.xwp-chip{display:flex;align-items:center;gap:12px;height:62px;padding:0 28px;border-radius:999px;font-size:26px;font-weight:700;letter-spacing:.02em;color:#fff6ea;background:rgba(11,12,18,.62)}\n.xwp-chip i{width:12px;height:12px;border-radius:50%}\n.xwp-chip.g{box-shadow:inset 0 0 0 1.5px rgba(246,196,69,.38)}.xwp-chip.g i{background:#f6c445;box-shadow:0 0 10px #f6c445}\n.xwp-chip.n{box-shadow:inset 0 0 0 1.5px rgba(143,214,90,.38)}.xwp-chip.n i{background:#8fd65a;box-shadow:0 0 10px #8fd65a}\n.xwp-cta{left:48px;right:48px;top:1462px;display:flex;flex-direction:column;align-items:center;gap:24px}\n.xwp-cue{display:flex;align-items:flex-end;gap:18px}.xwp-cue svg{animation:xwpNudge 1.8s ease-in-out infinite}\n@keyframes xwpNudge{50%{transform:translateY(8px)}}\n.xwp-cue b{padding-bottom:30px;font-size:26px;font-weight:700;letter-spacing:.3em;color:#fff6ea}\n.xpl a.xwp-btn,.xwp-btn{position:relative;width:860px;height:150px;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:26px;overflow:hidden;color:#0b2a17;text-decoration:none;background:linear-gradient(180deg,#3ee07f,#1fbe5a);box-shadow:inset 0 3px 0 rgba(255,255,255,.35),inset 0 -4px 0 rgba(0,60,20,.25),0 0 0 10px rgba(37,211,102,.16),0 0 120px 10px rgba(37,211,102,.5),0 40px 70px -24px rgba(0,0,0,.85);transition:transform .15s ease;animation:xwpBreathe 2.6s ease-in-out infinite}\n@keyframes xwpBreathe{50%{box-shadow:inset 0 3px 0 rgba(255,255,255,.35),inset 0 -4px 0 rgba(0,60,20,.25),0 0 0 18px rgba(37,211,102,.12),0 0 150px 18px rgba(37,211,102,.62),0 40px 70px -24px rgba(0,0,0,.85)}}\n.xwp-btn::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:38%;background:linear-gradient(100deg,rgba(255,255,255,.28),rgba(255,255,255,0))}\n.xwp-btn::after{content:\"\";position:absolute;top:0;bottom:0;left:-30%;width:22%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent);transform:skewX(-18deg);animation:xwpShine 3.4s ease-in-out 1.6s infinite}\n@keyframes xwpShine{0%{left:-30%}35%,100%{left:130%}}\n.xwp-btn svg,.xwp-btn b{position:relative}.xwp-btn b{font-size:60px;font-weight:700;letter-spacing:-.035em;line-height:1}\n.xwp-btn.pressed{transform:scale(.97)}\n.xwp-fine{font-size:28px;letter-spacing:.02em;color:rgba(225,224,204,.6)}\n.xwp-later{margin-top:8px;height:84px;padding:0 34px;border:0;border-radius:999px;background:rgba(255,246,234,.06);box-shadow:inset 0 0 0 2px rgba(255,236,200,.14);font:inherit;font-size:32px;font-weight:700;letter-spacing:-.01em;color:#E1E0CC;cursor:pointer;display:flex;align-items:center;gap:14px}\n.xwp-later:active{opacity:.6}\n.xwp-back{position:absolute;z-index:3;left:max(16px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top))}\n@media (prefers-reduced-motion:reduce){.xpl-lesson,.xpl-cap,.xpl-calc,.xpl-prog>span,.xinv{transition:none!important}.xpl-foot .sw svg,.xpl-cta,.xpl-voice .bar,.xpl-voice.wait,.xwp-ping,.xwp-hero,.xwp-hero .coin,.xwp-cue svg,.xwp-btn,.xwp-btn::after{animation:none}}\n"}];
export default defineDC("explore-mobile", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
