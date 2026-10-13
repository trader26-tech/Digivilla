import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber } from './rt.js?v=6fa182a2';
/* ── logic, verbatim from the design file ── */
const SLIDES = [
  ['assets/screens/home.webp', 'Home', 'Your estate, one glance', 'Value and this month’s rent on one screen.'],
  ['assets/screens/villa.webp', 'Villa detail', 'Inside every villa', 'What each villa holds, and what it pays.'],
  ['assets/screens/compare.webp', 'Compare', 'Compare anything', 'FD, flat or villa — same money, side by side.'],
  ['assets/screens/next.webp', 'Next villa', 'Next villa, dated', 'Your SIP tells you when the next one lands.'],
  ['assets/screens/fd.webp', 'FD vs DigiVilla', 'FD, side by side', 'What the bank pays vs what the city pays.'],
];
class Component extends DCLogic {
  state = { active: 0 };
  railRef = React.createRef(); capRef = React.createRef(); counterRef = React.createRef();
  componentDidMount() {
    const rail = this.railRef.current; if (!rail) return;
    this.layout = () => {
      const slides = [...rail.querySelectorAll('.msh-slide')]; if (!slides.length) return;
      const rc = rail.getBoundingClientRect(), rcx = rc.left + rc.width / 2;
      let best = 0, bd = 1e9;
      slides.forEach((sl, i) => {
        const r = sl.getBoundingClientRect(), d = (r.left + r.width / 2 - rcx) / r.width, ad = Math.min(1.2, Math.abs(d));
        const ph = sl.firstElementChild, dim = ph.querySelector('.dim');
        const tr = 'rotateY(' + (d * -22).toFixed(2) + 'deg) translateZ(' + (-ad * 140).toFixed(1) + 'px) scale(' + (1 - ad * .08).toFixed(4) + ')';
        if (ph.__t !== tr) { ph.style.transform = tr; ph.__t = tr; }
        const o = (ad * .45).toFixed(3); if (dim && dim.__o !== o) { dim.style.opacity = o; dim.__o = o; }
        ph.style.zIndex = Math.round(10 - ad * 5);
        if (Math.abs(d) < bd) { bd = Math.abs(d); best = i; }
      });
      if (best !== this.state.active && !this.swapping) {
        this.swapping = true;
        const cap = this.capRef.current, cnt = this.counterRef.current;
        if (cap) cap.style.opacity = 0; if (cnt) cnt.style.opacity = 0;
        setTimeout(() => { this.swapping = false; this.setState({ active: best }, () => { if (cap) cap.style.opacity = 1; if (cnt) cnt.style.opacity = 1; }); }, 180);
      }
    };
    this.onScroll = () => { if (!this.pending) { this.pending = true; requestAnimationFrame(() => { this.pending = false; this.layout(); }); } };
    rail.addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('resize', this.layout);
    requestAnimationFrame(this.layout); setTimeout(this.layout, 300); setTimeout(this.layout, 1200);
  }
  componentWillUnmount() { const rail = this.railRef.current; rail && rail.removeEventListener('scroll', this.onScroll); removeEventListener('resize', this.layout); }
  renderVals() {
    const a = this.state.active;
    return {
      railRef: this.railRef, capRef: this.capRef, counterRef: this.counterRef,
      slides: SLIDES.map(([src, alt]) => ({ src, alt })),
      cnum: String(a + 1).padStart(2, '0'), capTitle: SLIDES[a][2], capText: SLIDES[a][3],
      bars: SLIDES.map((_, i) => ({ cls: i === a ? 'on' : i < a ? 'done' : '' })),
    };
  }
}
/* ── template ── */
function tpl(v) { return [h("section", {"id": "showcase", "class": "msh", "data-screen-label": "App showcase (phone)"}, h("div", {"class": "msh-grid"}), h("div", {"class": "msh-glowp"}), h("div", {"class": "msh-head"}, h("div", {}, h("span", {"class": "msh-k"}, h("i", {}), "The DigiVilla app"), h("h2", {}, "Real estate,", h("br", {}), h("span", {}, "rebuilt as an app."))), h("div", {"ref": R(v," counterRef "), "class": "msh-counter"}, h("span", {}, ...T(v,["", " cnum ", ""])), h("small", {}, "/05"))), h("div", {"ref": R(v," railRef "), "class": "msh-rail", "aria-label": "App screens"}, ...((L => Array.isArray(L) ? L : [])(R(v," slides ")).map((it, i) => (v => [h("div", {"class": "msh-slide"}, h("div", {"class": "msh-phone"}, h("div", {"class": "bezel"}, h("div", {"class": "screen"}, h("img", {"src": R(v," s.src "), "alt": R(v," s.alt "), "loading": "lazy", "decoding": "async"}), h("div", {"class": "island"}), h("div", {"class": "sheen"}), h("div", {"class": "dim"})))))])({...v, "s": it, $index: i})))), h("div", {"class": "msh-foot"}, h("div", {"ref": R(v," capRef "), "class": "msh-cap"}, h("b", {}, ...T(v,["", " capTitle ", ""])), h("span", {}, ...T(v,["", " capText ", ""]))), h("div", {"class": "msh-bars"}, ...((L => Array.isArray(L) ? L : [])(R(v," bars ")).map((it, i) => (v => [h("i", {"class": R(v," b.cls ")})])({...v, "b": it, $index: i}))), h("span", {}, "Scroll →"))))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n/* ── PAGE 2 · APP SHOWCASE (phones) — ported from mobile-site.html ──────────────────────────\n   A 100svh black page: kicker, \"Real estate, / rebuilt as an app.\", a serif 01/05 counter, a\n   horizontal snap rail of five phones in perspective (the centred one upright and bright, the\n   neighbours turned away), the active phone's caption and five progress segments. Dimming is\n   an overlay, not a CSS filter, so the rail stays smooth while it scrolls. */\n.msh{position:relative;height:100vh;height:100svh;background:#000;display:flex;flex-direction:column;color:#ececf1;overflow:hidden;font-family:Almarai,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;scroll-snap-align:start;scroll-snap-stop:always}\n.msh-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(rgba(233,233,237,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(233,233,237,.045) 1px,transparent 1px);background-size:36px 36px;-webkit-mask-image:radial-gradient(ellipse 60% 45% at 50% 50%,#000 20%,transparent 100%);mask-image:radial-gradient(ellipse 60% 45% at 50% 50%,#000 20%,transparent 100%)}\n.msh-glowp{position:absolute;left:50%;top:50%;width:120%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(closest-side,rgba(127,114,224,.22),rgba(127,114,224,.05) 50%,transparent)}\n.msh-head{position:relative;z-index:2;padding:max(44px,env(safe-area-inset-top)) 24px 0;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}\n.msh-k{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#7a7c8c}\n.msh-k i{width:6px;height:6px;border-radius:50%;background:#8fd65a;box-shadow:0 0 10px #8fd65a}\n.msh h2{margin:12px 0 0;font-size:clamp(30px,9.5vw,40px);font-weight:800;line-height:1.02;letter-spacing:-.045em}\n.msh h2 span{color:#7a7c8c}\n.msh-counter{flex:none;display:flex;align-items:baseline;gap:4px;font-family:'Instrument Serif',serif;font-style:italic;font-size:48px;line-height:1;color:#ececf1;transition:opacity .25s}\n.msh-counter small{font-family:Almarai,sans-serif;font-style:normal;font-size:12px;letter-spacing:.2em;color:#7a7c8c}\n.msh-rail{position:relative;z-index:2;flex:1;min-height:0;display:flex;align-items:center;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;perspective:1200px;perspective-origin:50% 50%;padding:0 14%;gap:0;touch-action:pan-x;overscroll-behavior-x:contain}\n.msh-rail::-webkit-scrollbar{display:none}\n.msh-slide{flex:none;width:72%;height:100%;scroll-snap-align:center;display:grid;place-items:center;transform-style:preserve-3d;padding:14px 0}\n.msh-phone{position:relative;height:100%;max-height:600px;max-width:100%;aspect-ratio:360/759;will-change:transform}\n.msh-phone .bezel{position:absolute;inset:0;border-radius:15%/7%;padding:3.2%;background:linear-gradient(160deg,#a8aab1 0%,#3a3b41 10%,#141518 30%,#0a0a0c 60%,#2b2c31 85%,#8e9097 100%);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.26),inset 0 0 0 4px #050506,0 50px 90px -30px rgba(0,0,0,1),0 0 90px -20px rgba(127,114,224,.25)}\n.msh-phone .screen{position:relative;width:100%;height:100%;border-radius:13%/6%;overflow:hidden;background:#161826}\n.msh-phone .screen img{display:block;width:100%;height:100%;object-fit:cover}\n.msh-phone .island{position:absolute;left:50%;top:1.6%;width:30%;height:3.8%;transform:translateX(-50%);border-radius:999px;background:#000}\n.msh-phone .sheen{position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,255,255,.10),transparent 30%,transparent 70%,rgba(255,255,255,.04))}\n.msh-phone .dim{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}\n.msh-foot{position:relative;z-index:2;padding:0 24px max(22px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:18px}\n.msh-cap{display:flex;flex-direction:column;gap:6px;min-height:72px;transition:opacity .25s}\n.msh-cap b{font-size:24px;font-weight:800;letter-spacing:-.04em;color:#ececf1}.msh-cap span{font-size:15px;line-height:1.4;color:#a3a5b4;text-wrap:pretty}\n.msh-bars{display:flex;align-items:center;gap:10px}\n.msh-bars i{flex:1;height:2px;border-radius:1px;background:#22253a;transition:background .3s}.msh-bars i.on{background:#8fd65a}.msh-bars i.done{background:rgba(143,214,90,.4)}\n.msh-bars span{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:#7a7c8c;margin-left:8px;white-space:nowrap}\n"}];
export default defineDC("showcase-mobile", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
