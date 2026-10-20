import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=2ff5d5b4';
import C_calculator from './calculator.js?v=2ff5d5b4';
import C_part_footer from './part-footer.js?v=2ff5d5b4';
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S("min-height:100vh;background:#0b0c12")}, h(C_calculator, {"embedded": R(v," true "), "kicker": "CHAPTER 03 · YOUR NUMBERS"}), h(C_part_footer, {}))]; }
export const HELMET = [{"tag": "title", "attrs": {}, "text": "TheDigiCiti · Your numbers"}, {"tag": "script", "attrs": {"src": "part-transitions.js"}, "text": ""}, {"tag": "style", "attrs": {}, "text": "body{margin:0;background:#0b0c12;color:#e9e9ed;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}a{color:#b5abfc;text-decoration:none}a:hover{color:#d4cdfd}"}];
export default defineDC("story-3-numbers", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
