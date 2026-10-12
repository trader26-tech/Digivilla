import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber } from './rt.js?v=92be4bce';
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {
  renderVals() {
    if (this.__vals) return this.__vals;              // pure geometry — build it once
    const W = 311.8, H = 180;
    const px = (a, b) => 410 + (a - b) * W, py = (a, b) => 70 + (a + b) * H;
    const r1 = n => Math.round(n * 10) / 10;
    const P = arr => arr.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
    const PG = (pts, fill, op = 1) => ({ isPoly: true, pts, fill, op });
    const E = (cx, cy, rx, ry, fill, op = 1) => ({ isEllipse: true, cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, op });
    const fringe = [];
    for (let i = 0; i < 8; i++) {
      const x = 688.2 - i * 37.45, y = 283.4 + i * 21.6;
      fringe.push({ pts: `${r1(x)},${r1(y)} ${r1(x + 17.4)},${r1(y - 10)} ${r1(x + 8.7)},${r1(y + 10)}`, fill: '#59a52e' });
      const lx = 376.4 - i * 37.45, ly = 424.6 - i * 21.6;
      fringe.push({ pts: `${r1(lx)},${r1(ly)} ${r1(lx + 17.4)},${r1(ly + 10)} ${r1(lx + 8.7)},${r1(ly + 20)}`, fill: '#3f7a20' });
    }
    // a point on the grass at height z
    const pt = (a, b, z = 0) => [px(a, b), py(a, b) - z];
    // flat diamond on the ground plane (or raised by z)
    const flat = (a0, b0, a1, b1, fill, op = 1, z = 0) => PG(P([pt(a0, b0, z), pt(a1, b0, z), pt(a1, b1, z), pt(a0, b1, z)]), fill, op);
    // an iso box: top, right face (a = a1, lit), left face (b = b1, shaded)
    const box = (a0, b0, a1, b1, z0, h, [top, right, left]) => [
      PG(P([pt(a1, b0, z0 + h), pt(a1, b1, z0 + h), pt(a1, b1, z0), pt(a1, b0, z0)]), right),
      PG(P([pt(a0, b1, z0 + h), pt(a1, b1, z0 + h), pt(a1, b1, z0), pt(a0, b1, z0)]), left),
      PG(P([pt(a0, b0, z0 + h), pt(a1, b0, z0 + h), pt(a1, b1, z0 + h), pt(a0, b1, z0 + h)]), top),
    ];
    // a panel on the right face of a box (a = const), spanning b and z
    const onRight = (a, b0, b1, z0, z1, fill, op = 1) => PG(P([pt(a, b0, z1), pt(a, b1, z1), pt(a, b1, z0), pt(a, b0, z0)]), fill, op);
    // a panel on the left face (b = const), spanning a and z
    const onLeft = (b, a0, a1, z0, z1, fill, op = 1) => PG(P([pt(a0, b, z1), pt(a1, b, z1), pt(a1, b, z0), pt(a0, b, z0)]), fill, op);
    const WALL = ['#f3ebdb', '#e9dfc9', '#cfc3a9'], ROOF = ['#faf4e8', '#e4d9c2', '#c8bba0'], GLASS = '#2f4d6c', GLASS_LIT = '#5f87ad', FRAME = '#efe6d7';
    const HEDGE = ['#7cc945', '#59a52e', '#3f7a20'], WOOD = ['#c48a52', '#a97140', '#7d5027'];
    const S = [];
    // ── ground: paths, pool, lawn shadow of the house ──
    S.push(flat(0.56, 0.48, 0.66, 0.97, '#d9d0bd', 0.9));                                  // path from the door to the front edge
    S.push(flat(0.26, 0.10, 0.74, 0.50, '#35691b', 0.30));                                  // soft shadow where the house meets the lawn
    S.push(flat(0.96, 0.40, 0.98, 0.84, '#35691b', 0.3));
    // pool, front-left: stone rim, deep water, lit water, two highlights, a deck board
    S.push(flat(0.10, 0.56, 0.42, 0.84, '#e8e0cf'));
    S.push(flat(0.12, 0.58, 0.40, 0.82, '#2c6f86'));
    S.push(flat(0.13, 0.59, 0.39, 0.81, '#4fb9cc'));
    S.push(flat(0.15, 0.61, 0.33, 0.73, '#7fd3e0', 0.85));
    S.push(PG(P([pt(0.19, 0.63), pt(0.27, 0.63), pt(0.28, 0.65), pt(0.20, 0.65)]), '#dff6f8', 0.8));
    S.push(PG(P([pt(0.21, 0.70), pt(0.26, 0.70), pt(0.265, 0.713), pt(0.215, 0.713)]), '#dff6f8', 0.6));
    S.push(flat(0.42, 0.56, 0.48, 0.84, '#c9a675'));                                        // timber deck beside the pool
    S.push(flat(0.42, 0.56, 0.48, 0.84, '#a97140', 0.25));
    // ── fence along the four edges (posts + two rails); back edges first ──
    const post = (a, b) => S.push(...box(a - 0.012, b - 0.012, a + 0.012, b + 0.012, 0, 26, WOOD));
    const railA = (a0, a1, b, z) => S.push(...box(a0, b - 0.006, a1, b + 0.006, z, 5, WOOD));   // rail running along a
    const railB = (a, b0, b1, z) => S.push(...box(a - 0.006, b0, a + 0.006, b1, z, 5, WOOD));   // rail running along b
    const F = 0.035, N = 7;
    const back = () => {
      for (let i = 0; i <= N; i++) { const t = F + (1 - 2 * F) * i / N; post(t, F); post(F, t); }
      railA(F, 1 - F, F, 10); railA(F, 1 - F, F, 20); railB(F, F, 1 - F, 10); railB(F, F, 1 - F, 20);
    };
    const front = () => {
      railA(F, 1 - F, 1 - F, 10); railA(F, 1 - F, 1 - F, 20); railB(1 - F, F, 1 - F, 10); railB(1 - F, F, 1 - F, 20);
      for (let i = 0; i <= N; i++) { const t = F + (1 - 2 * F) * i / N; if (i < N) post(t, 1 - F); if (i < N) post(1 - F, t); }
      post(1 - F, 1 - F);
    };
    back();
    // ── back garden: a tall clipped tree on a trunk, hedges ──
    S.push(E(px(0.90, 0.16), py(0.90, 0.16) + 2, 44, 20, '#35691b', 0.35));
    S.push(...box(0.885, 0.145, 0.915, 0.175, 0, 48, WOOD));
    S.push(...box(0.81, 0.07, 0.99, 0.25, 44, 78, HEDGE));
    S.push(...box(0.12, 0.26, 0.22, 0.36, 0, 26, HEDGE));
    S.push(...box(0.10, 0.44, 0.18, 0.52, 0, 20, HEDGE));
    // ── the house: tall block (back) + single-storey wing (front-right) ──
    const A0 = 0.30, A1 = 0.72, B0 = 0.10, B1 = 0.48, HT = 158;         // tall block
    const C0 = 0.58, C1 = 0.92, D0 = 0.40, D1 = 0.80, HW = 78;          // wing
    S.push(...box(A0, B0, A1, B1, 0, HT, WALL));
    // tall block · right face (a = A1): two floors of glazing
    S.push(onRight(A1 + 0.001, 0.15, 0.43, 96, 138, FRAME));
    S.push(onRight(A1 + 0.002, 0.16, 0.42, 98, 136, GLASS));
    S.push(onRight(A1 + 0.003, 0.17, 0.27, 100, 134, GLASS_LIT, 0.55));
    S.push(onRight(A1 + 0.001, 0.15, 0.31, 30, 72, FRAME));
    S.push(onRight(A1 + 0.002, 0.16, 0.30, 32, 70, GLASS));
    S.push(onRight(A1 + 0.003, 0.17, 0.22, 34, 68, GLASS_LIT, 0.55));
    // tall block · left face (b = B1): upper window, lower window, the front door
    S.push(onLeft(B1 + 0.001, 0.34, 0.66, 96, 138, FRAME));
    S.push(onLeft(B1 + 0.002, 0.35, 0.65, 98, 136, GLASS));
    S.push(onLeft(B1 + 0.003, 0.36, 0.47, 100, 134, GLASS_LIT, 0.4));
    S.push(onLeft(B1 + 0.001, 0.33, 0.50, 28, 66, FRAME));
    S.push(onLeft(B1 + 0.002, 0.34, 0.49, 30, 64, GLASS));
    S.push(onLeft(B1 + 0.001, 0.555, 0.665, 0, 60, '#8a5a2f'));
    S.push(onLeft(B1 + 0.002, 0.565, 0.655, 0, 58, '#a97140'));
    S.push(onLeft(B1 + 0.003, 0.64, 0.65, 26, 32, '#f2dc9a'));                               // handle
    // roof slab of the tall block (slight overhang) + a parapet line
    S.push(...box(A0 - 0.02, B0 - 0.02, A1 + 0.02, B1 + 0.02, HT, 9, ROOF));
    S.push(flat(A0 + 0.02, B0 + 0.02, A1 - 0.02, B1 - 0.02, '#d8ccb3', 1, HT + 9));
    // the wing
    S.push(...box(C0, D0, C1, D1, 0, HW, WALL));
    S.push(onRight(C1 + 0.001, 0.46, 0.74, 22, 62, FRAME));
    S.push(onRight(C1 + 0.002, 0.47, 0.73, 24, 60, GLASS));
    S.push(onRight(C1 + 0.003, 0.48, 0.57, 26, 58, GLASS_LIT, 0.55));
    S.push(onLeft(D1 + 0.001, 0.63, 0.87, 22, 62, FRAME));
    S.push(onLeft(D1 + 0.002, 0.64, 0.86, 24, 60, GLASS));
    S.push(onLeft(D1 + 0.003, 0.65, 0.73, 26, 58, GLASS_LIT, 0.4));
    S.push(...box(C0 - 0.02, D0 - 0.02, C1 + 0.02, D1 + 0.02, HW, 8, ROOF));
    S.push(flat(C0 + 0.02, D0 + 0.02, C1 - 0.02, D1 - 0.02, '#d8ccb3', 1, HW + 8));
    // ── front garden: clipped cubes, a lounger by the pool, then the front fence ──
    S.push(...box(0.50, 0.86, 0.58, 0.94, 0, 22, HEDGE));
    S.push(...box(0.72, 0.86, 0.80, 0.94, 0, 18, HEDGE));
    S.push(...box(0.20, 0.88, 0.30, 0.96, 0, 16, HEDGE));
    S.push(...box(0.44, 0.60, 0.465, 0.70, 6, 4, ['#f2dc9a', '#e0c77c', '#c4ab62']));           // lounger
    front();
    this.__vals = { doc: !this.props.tile, wrapPad: this.props.tile ? '0' : '48px 24px 80px', fringe, shapes: S };
    return this.__vals;
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S(J(v,["max-width:920px;margin:0 auto;padding:", " wrapPad ", ""])), "data-tile-wrap": "1"}, "\n  ", (R(v," doc ") ? ["\n  ", h("h1", {"style": S("font-weight:500;font-size:26px;letter-spacing:-.01em;margin:0 0 6px")}, "Isometric plot — the villa"), "\n  ", h("p", {"style": S("color:#9a9aa5;margin:0 0 28px")}, "Stage 5 of the ladder: a two-storey white villa with a single-storey wing, a pool, a timber fence and clipped hedges. Flat polygons only, three values per solid."), "\n  "] : null), "\n  ", h("svg", {"viewBox": "0 -60 820 700", "style": S("width:100%;height:auto;display:block")}, "\n    ", h("polygon", {"points": "410,100 794.5,322 410,544 25.5,322", "fill": "#232739"}), "\n    ", h("polygon", {"points": "794.5,322 410,544 410,595 794.5,373", "fill": "#1b1e2c"}), "\n    ", h("polygon", {"points": "410,544 25.5,322 25.5,373 410,595", "fill": "#12141d"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,516 721.8,336", "fill": "#8a5a33"}), "\n    ", h("polygon", {"points": "410,444 98.2,264 98.2,336 410,516", "fill": "#6d4527"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,458 721.8,278", "fill": "#3f2a18", "opacity": "0.35"}), "\n    ", h("polygon", {"points": "721.8,250 410,430 410,444 721.8,264", "fill": "#59a52e"}), "\n    ", h("polygon", {"points": "410,430 98.2,250 98.2,264 410,444", "fill": "#3f7a20"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," fringe ")).map((it, i) => (v => [h("polygon", {"points": R(v," f.pts "), "fill": R(v," f.fill ")})])({...v, "f": it, $index: i}))), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "#6cba36"}), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "none", "stroke": "#3f7a20", "stroke-width": "8"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," shapes ")).map((it, i) => (v => ["\n      ", (R(v," t.isPoly ") ? [h("polygon", {"points": R(v," t.pts "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n      ", (R(v," t.isEllipse ") ? [h("ellipse", {"cx": R(v," t.cx "), "cy": R(v," t.cy "), "rx": R(v," t.rx "), "ry": R(v," t.ry "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n    "])({...v, "t": it, $index: i}))), "\n  "))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n    body { margin:0; background:transparent; color:#e9e9ed; font:14px/1.5 Inter, system-ui, sans-serif; }\n  "}];
export default defineDC("part-stage-villa", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
