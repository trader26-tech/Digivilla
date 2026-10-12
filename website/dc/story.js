import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready } from './rt.js?v=5565a973';
import C_story_1_journey from './story-1-journey.js?v=5565a973';
import C_story_2_map from './story-2-map.js?v=5565a973';
import C_story_3_numbers from './story-3-numbers.js?v=5565a973';
addCSS(".p-story-1:hover{gap:16px !important;color:#fff !important;box-shadow:inset 0 0 0 1px rgba(255,236,200,.5), inset 0 1px 0 rgba(255,255,255,.2), 0 0 34px rgba(255,200,130,.25), 0 10px 30px -12px rgba(0,0,0,.7) !important}");
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {
  // Explore sets localStorage['thedigiciti.chapter'] = '0'; a nav link can ask for a chapter with #1 / #2 / #3.
  state = { ch: (() => { const h = parseInt((location.hash || '').replace('#', ''), 10); if (h >= 1 && h <= 3) return h - 1; try { const v = parseInt(localStorage.getItem('thedigiciti.chapter'), 10); if (v >= 0 && v <= 2) return v; } catch (e) {} return 0; })(), from: -1, wipe: false, phase: 0, nxt: 0 };
  calcRef = React.createRef();
  componentDidMount() {
    try { localStorage.setItem('thedigiciti.chapter', this.state.ch); } catch (e) {}
    this.atEnd = () => { const c = this.calcRef.current; return this.state.ch === 2 && c && c.scrollTop + c.clientHeight >= c.scrollHeight - 4; };
    this.pushes = 0;
    // chapter 3 scrolls like a page; pushing past its end returns to the app showcase
    this.onWheelEnd = e => { if (this.state.ch !== 2 || this.state.wipe) { this.pushes = 0; return; } if (e.deltaY > 0 && this.atEnd()) { if (++this.pushes >= 3) this.toApp(); } else this.pushes = 0; };
    this.onTouchS = e => { this.tY = e.touches[0].clientY; };
    this.onTouchE = e => { if (this.state.ch !== 2 || this.tY == null) return; const dy = this.tY - e.changedTouches[0].clientY; this.tY = null; if (dy > 48 && this.atEnd()) this.toApp(); };
    this.onKeyEnd = e => {
      if (e.key === 'Escape') { if (!this.leaving) { this.leaving = true; window.tdcVeil && window.tdcVeil.go('index.html', { style: 'sky', fast: true }); } return; }
      if (e.key === 'ArrowRight') this.goTo(this.state.ch + 1);
      if (e.key === 'ArrowLeft') this.goTo(this.state.ch - 1);
    };
    addEventListener('wheel', this.onWheelEnd, { passive: true });
    addEventListener('touchstart', this.onTouchS, { passive: true }); addEventListener('touchend', this.onTouchE, { passive: true });
    addEventListener('keydown', this.onKeyEnd);
  }
  componentWillUnmount() { removeEventListener('wheel', this.onWheelEnd); removeEventListener('touchstart', this.onTouchS); removeEventListener('touchend', this.onTouchE); removeEventListener('keydown', this.onKeyEnd); }
  toApp() {
    if (this.leaving) return; this.leaving = true;
    window.tdcVeil && window.tdcVeil.go('index.html#showcase', { style: 'sky' });
  }
  goTo(n) {
    n = Math.max(0, Math.min(2, n));
    if (n === this.state.ch || this.busy) return;
    this.busy = true;
    this.setState({ wipe: true, phase: 0, nxt: n });
    requestAnimationFrame(() => requestAnimationFrame(() => this.setState({ phase: 1 })));
    setTimeout(() => { this.setState(s => ({ ch: n, from: s.ch, phase: 2 })); try { localStorage.setItem('thedigiciti.chapter', n); history.replaceState(null, '', '#' + (n + 1)); } catch (e) {} }, 900);
    setTimeout(() => this.setState({ phase: 3 }), 1700);
    setTimeout(() => { this.setState({ wipe: false, phase: 0 }); this.busy = false; }, 2600);
  }
  renderVals() {
    const { ch, from, wipe, phase, nxt } = this.state;
    const T = ['The journey', 'Reading the map', 'Your numbers'];
    const open = phase === 1 || phase === 2;
    const btn = i => `display:flex;align-items:center;gap:8px;height:34px;padding:0 14px;border:0;border-radius:999px;font:inherit;font-size:11.5px;letter-spacing:.04em;white-space:nowrap;cursor:pointer;color:${ch === i ? '#fff6ea' : '#8a8ea3'};background:${ch === i ? 'rgba(246,196,69,.14)' : 'transparent'};transition:all .3s`;
    const dot = i => `width:7px;height:7px;border-radius:50%;flex:none;background:${ch === i ? '#f6c445' : 'rgba(255,255,255,.22)'};box-shadow:${ch === i ? '0 0 10px rgba(246,196,69,.8)' : 'none'};transition:all .3s`;
    const pv = e => { e && e.preventDefault && e.preventDefault(); };
    return {
      calcRef: this.calcRef,
      goHome: e => { pv(e); if (this.leaving) return; this.leaving = true; window.tdcVeil && window.tdcVeil.go('index.html', { style: 'sky', fast: true }); },
      isFlight: ch === 0, isLesson: ch === 1, isCalc: ch === 2,
      flightFromEnd: ch === 0 && from === 1, lessonFromEnd: ch === 1 && from === 2,
      next0: () => this.goTo(1), next1: () => this.goTo(2), prev1: () => this.goTo(0),
      go0: e => { pv(e); this.goTo(0); }, go1: e => { pv(e); this.goTo(1); }, go2: e => { pv(e); this.goTo(2); },
      cur0: ch === 0 ? 'step' : null, cur1: ch === 1 ? 'step' : null, cur2: ch === 2 ? 'step' : null,
      ch0: btn(0), ch1: btn(1), ch2: btn(2), dot0: dot(0), dot1: dot(1), dot2: dot(2),
      wipeOn: wipe,
      wipeStyle: `position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;background:radial-gradient(ellipse 45% 50% at 50% 45%,rgba(246,196,69,.16),transparent 70%),radial-gradient(ellipse 50% 30% at 50% 100%,rgba(42,43,107,.6),transparent 70%),linear-gradient(180deg,#0c0e24,#0a0b16);transition:clip-path .85s cubic-bezier(.7,0,.3,1);clip-path:circle(${open ? '125%' : '0%'} at 50% 50%)`,
      labelStyle: `position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;opacity:${open ? 1 : 0};transform:scale(${open ? 1 : .8});transition:opacity .45s ease ${phase === 1 ? '.35s' : '0s'},transform .6s cubic-bezier(.2,.8,.2,1)`,
      nextNum: '0' + (nxt + 1), nextTitle: T[nxt]
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S("position:fixed;inset:0;overflow:hidden;background:#0b0c12")}, (R(v," isFlight ") ? [h("div", {"style": S("position:absolute;inset:0")}, h(C_story_1_journey, {"onNext": R(v," next0 "), "startAtEnd": R(v," flightFromEnd ")}))] : null), (R(v," isLesson ") ? [h("div", {"style": S("position:absolute;inset:0")}, h(C_story_2_map, {"onNext": R(v," next1 "), "onPrev": R(v," prev1 "), "startAtEnd": R(v," lessonFromEnd ")}))] : null), (R(v," isCalc ") ? [h("div", {"ref": R(v," calcRef "), "style": S("position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none")}, h(C_story_3_numbers, {}))] : null), h("div", {"style": S("position:absolute;left:0;right:0;top:0;z-index:40;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px clamp(16px,3vw,40px);pointer-events:none")}, h("a", {"href": "index.html", "onClick": R(v," goHome "), "aria-label": "Back to TheDigiCiti home", "style": S("pointer-events:auto;position:relative;display:flex;align-items:center;gap:12px;height:44px;padding:0 8px 0 5px;border-radius:999px;background:linear-gradient(180deg,rgba(255,244,222,.10),rgba(255,226,186,.03)),rgba(11,12,18,.5);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);box-shadow:inset 0 0 0 1px rgba(255,236,200,.18), inset 0 1px 0 rgba(255,255,255,.12), 0 10px 30px -12px rgba(0,0,0,.7);color:#E1E0CC;transition:box-shadow .35s, gap .35s"), "class": "p-story-1"}, h("span", {"style": S("width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#E1E0CC;color:#0b0c12;box-shadow:0 0 18px rgba(255,214,150,.35)")}, h("svg", {"width": "15", "height": "15", "viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round"}, h("path", {"d": "M19 12H5M11 6l-6 6 6 6"}))), h("span", {"data-sh": "label", "style": S("display:flex;flex-direction:column;gap:3px;line-height:1")}, h("span", {"style": S("font-size:9px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,226,170,.75)")}, "Back to"), h("span", {"style": S("font-size:14px;font-weight:600;letter-spacing:-.01em")}, "TheDigiCiti")), h("span", {"data-sh": "label", "style": S("margin-left:4px;height:22px;min-width:30px;padding:0 6px;border-radius:6px;display:grid;place-items:center;font-size:10px;font-weight:600;letter-spacing:.04em;color:rgba(225,224,204,.55);box-shadow:inset 0 0 0 1px rgba(225,224,204,.2), inset 0 -2px 0 rgba(225,224,204,.08)")}, "esc")), h("nav", {"aria-label": "Chapters", "data-sh": "pills", "style": S("pointer-events:auto;display:flex;gap:2px;padding:4px;border-radius:999px;background:linear-gradient(180deg,rgba(255,244,222,.08),rgba(255,226,186,.02)),rgba(11,12,18,.5);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);box-shadow:inset 0 0 0 1px rgba(255,236,200,.16), inset 0 1px 0 rgba(255,255,255,.1), 0 10px 30px -12px rgba(0,0,0,.7)")}, h("button", {"onClick": R(v," go0 "), "aria-current": R(v," cur0 "), "style": S(R(v," ch0 "))}, h("i", {"style": S(R(v," dot0 "))}), h("span", {"data-sh": "label"}, h("b", {"style": S("font-weight:600;margin-right:6px;opacity:.7")}, "01"), "The journey")), h("button", {"onClick": R(v," go1 "), "aria-current": R(v," cur1 "), "style": S(R(v," ch1 "))}, h("i", {"style": S(R(v," dot1 "))}), h("span", {"data-sh": "label"}, h("b", {"style": S("font-weight:600;margin-right:6px;opacity:.7")}, "02"), "Reading the map")), h("button", {"onClick": R(v," go2 "), "aria-current": R(v," cur2 "), "style": S(R(v," ch2 "))}, h("i", {"style": S(R(v," dot2 "))}), h("span", {"data-sh": "label"}, h("b", {"style": S("font-weight:600;margin-right:6px;opacity:.7")}, "03"), "Your numbers"))), h("span", {"style": S("width:44px;flex:none")})), h("div", {"style": S("position:absolute;inset:0;z-index:50;pointer-events:none")}, (R(v," wipeOn ") ? [h("div", {"style": S(R(v," wipeStyle "))}, h("div", {"style": S("position:absolute;inset:0;background-image:radial-gradient(rgba(255,236,190,.16) 1px,transparent 1.2px);background-size:28px 28px;-webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 30%,transparent 90%);mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 30%,transparent 90%)")}), h("div", {"style": S(R(v," labelStyle "))}, h("div", {"style": S("width:18vh;height:18vh;border-radius:50%;background:radial-gradient(circle at 34% 26%,#fff4c8 0%,#fbdb81 18%,#f6c445 45%,#d8961f 78%,#9a5f0c 100%);box-shadow:inset 0 0 0 .5vh #d8961f,inset 0 0 0 .65vh #9a5f0c,inset 0 -1.2vh 3vh rgba(90,50,0,.4),0 0 80px 20px rgba(246,196,69,.25);display:grid;place-items:center;animation:dcSpin 1.6s cubic-bezier(.45,0,.55,1) infinite")}, h("span", {"style": S("font-size:6vh;font-weight:600;color:#8a5208;text-shadow:0 1px 0 rgba(255,240,200,.6)")}, ...T(v,["", " nextNum ", ""]))), h("span", {"style": S("font-size:11px;letter-spacing:.32em;color:#f6c445")}, ...T(v,["CHAPTER ", " nextNum ", ""])), h("span", {"style": S("font-size:clamp(28px,3.6vw,52px);font-weight:500;letter-spacing:-.04em;line-height:1;color:#fff6ea;text-align:center")}, ...T(v,["", " nextTitle ", ""]))))] : null)))]; }
export const HELMET = [{"tag": "title", "attrs": {}, "text": "TheDigiCiti"}, {"tag": "link", "attrs": {"rel": "stylesheet", "href": "_ds/digivilla-design-system-6b341fe6-8a81-4528-a299-1cfcf6fd6497/tokens/fonts.css"}, "text": ""}, {"tag": "link", "attrs": {"rel": "stylesheet", "href": "_ds/digivilla-design-system-6b341fe6-8a81-4528-a299-1cfcf6fd6497/tokens/colors.css"}, "text": ""}, {"tag": "link", "attrs": {"rel": "stylesheet", "href": "_ds/digivilla-design-system-6b341fe6-8a81-4528-a299-1cfcf6fd6497/tokens/typography.css"}, "text": ""}, {"tag": "link", "attrs": {"rel": "stylesheet", "href": "_ds/digivilla-design-system-6b341fe6-8a81-4528-a299-1cfcf6fd6497/tokens/spacing.css"}, "text": ""}, {"tag": "link", "attrs": {"rel": "stylesheet", "href": "_ds/digivilla-design-system-6b341fe6-8a81-4528-a299-1cfcf6fd6497/tokens/base.css"}, "text": ""}, {"tag": "link", "attrs": {"rel": "stylesheet", "href": "_ds/digivilla-design-system-6b341fe6-8a81-4528-a299-1cfcf6fd6497/styles.css"}, "text": ""}, {"tag": "script", "attrs": {"src": "part-transitions.js"}, "text": ""}, {"tag": "script", "attrs": {}, "text": "window.tdcVeil && window.tdcVeil.prefetch([\"index.html\"]);"}, {"tag": "style", "attrs": {}, "text": "html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:#0b0c12;color:#ececf1;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}a{color:#f6c445;text-decoration:none}a:hover{color:#fbdb81}@keyframes dcSpin{0%{transform:scaleX(1)}50%{transform:scaleX(.12)}100%{transform:scaleX(1)}}@keyframes dcRise{0%{opacity:0;transform:translateY(14px)}100%{opacity:1;transform:translateY(0)}}@media (max-width:640px){[data-sh=\"label\"]{display:none!important}[data-sh=\"pills\"] button{padding:0 10px!important}}"}];
export default defineDC("story", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
