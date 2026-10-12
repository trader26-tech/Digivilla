import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready } from './rt.js?v=5565a973';
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {
  renderVals() {
    const W = 311.8, H = 180, D = 14;
    const px = (a, b) => 410 + (a - b) * W, py = (a, b, h = 0) => 70 + (a + b) * H - h;
    const r1 = n => Math.round(n * 10) / 10;
    const P = arr => arr.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
    const E = (cx, cy, rx, ry, fill, op = 1) => ({ isEllipse: true, cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, op });
    const PG = (pts, fill, op = 1) => ({ isPoly: true, pts, fill, op });
    const pt = (a, b, h = 0) => [px(a, b), py(a, b, h)];
    // iso box → [left(+b) face, right(+a) face, top]
    const box = (a0, b0, a1, b1, h0, h1, [top, right, left]) => [
      PG(P([pt(a0, b1, h1), pt(a1, b1, h1), pt(a1, b1, h0), pt(a0, b1, h0)]), left),
      PG(P([pt(a1, b0, h1), pt(a1, b1, h1), pt(a1, b1, h0), pt(a1, b0, h0)]), right),
      PG(P([pt(a0, b0, h1), pt(a1, b0, h1), pt(a1, b1, h1), pt(a0, b1, h1)]), top),
    ];

    const fringe = [];
    for (let i = 0; i < 8; i++) {
      const x = 688.2 - i * 37.45, y = 283.4 + i * 21.6;
      fringe.push({ pts: P([[x, y], [x + 17.4, y - 10], [x + 8.7, y + 10]]), fill: '#59a52e' });
      const lx = 376.4 - i * 37.45, ly = 424.6 - i * 21.6;
      fringe.push({ pts: P([[lx, ly], [lx + 17.4, ly + 10], [lx + 8.7, ly + 20]]), fill: '#3f7a20' });
    }
    const stripes = [];
    for (let b0 = 0.05; b0 < 0.95; b0 += 0.2) {
      const b1 = Math.min(b0 + 0.1, 0.97);
      stripes.push({ pts: P([pt(0.03, b0), pt(0.97, b0), pt(0.97, b1), pt(0.03, b1)]) });
    }
    const track = P([pt(0.8, 0.44), pt(1, 0.42), pt(1, 0.6), pt(0.8, 0.58)]);

    // ---- foundation
    const A0 = 0.2, A1 = 0.8, B0 = 0.2, B1 = 0.8, S0 = 0.235, S1 = 0.765, SPLIT = 0.5, TOP = 6;
    const CON = ['#b0b4ba', '#9aa0a7', '#7c8189'], WOOD = ['#c9a97a', '#a97140', '#8a5a2f'];
    const pit = [
      PG(P([pt(A0, B0, -D), pt(A1, B0, -D), pt(A1, B1, -D), pt(A0, B1, -D)]), '#6b6157'),
      PG(P([pt(A0, B0, 0), pt(A0, B1, 0), pt(A0, B1, -D), pt(A0, B0, -D)]), '#8a5a33'),
      PG(P([pt(A0, B0, 0), pt(A1, B0, 0), pt(A1, B0, -D), pt(A0, B0, -D)]), '#6d4527'),
      PG(P([pt(A0, B0, -D), pt(A1, B0, -D), pt(A1, B0, -D + 4), pt(A0, B0, -D + 4)]), '#3f2a18', 0.4),
      PG(P([pt(A0, B0, -D), pt(A0, B1, -D), pt(A0, B1, -D + 4), pt(A0, B0, -D + 4)]), '#3f2a18', 0.25),
    ];
    const T = 0.012, FH = 10;
    const formBack = [
      ...box(A0, B0, A0 + T, B1, -D, FH, WOOD),
      ...box(A0, B0, A1, B0 + T, -D, FH, WOOD),
    ];
    const formFront = [
      ...box(A1 - T, B0, A1, B1, -D, FH, WOOD),
      ...box(A0, B1 - T, A1, B1, -D, FH, WOOD),
    ];
    const stakes = [];
    for (const t of [0.28, 0.5, 0.72]) {
      stakes.push(...box(A1 + 0.004, t, A1 + 0.018, t + 0.014, 0, 18, ['#a97140', '#8a5a2f', '#6b4522']));
      stakes.push(...box(t, B1 + 0.004, t + 0.014, B1 + 0.018, 0, 18, ['#a97140', '#8a5a2f', '#6b4522']));
    }
    const slab = [
      ...box(S0, B0 + T, SPLIT, S1, -D, TOP, CON),                       // set half (back)
      ...box(SPLIT, B0 + T, S1, S1, -D, TOP, ['#8e939a', '#7c8189', '#656a72']), // wet half (front)
      PG(P([pt(SPLIT, B0 + T, TOP), pt(SPLIT + 0.01, B0 + T, TOP), pt(SPLIT + 0.01, S1, TOP), pt(SPLIT, S1, TOP)]), '#c3c7cc', 0.5),
      // control joints on the set half
      PG(P([pt(S0, 0.5, TOP), pt(SPLIT, 0.5, TOP), pt(SPLIT, 0.505, TOP), pt(S0, 0.505, TOP)]), '#7c8189', 0.45),
      PG(P([pt(0.37, B0 + T, TOP), pt(0.375, B0 + T, TOP), pt(0.375, S1, TOP), pt(0.37, S1, TOP)]), '#7c8189', 0.45),
      // fresh pour pool under the chute
      E(px(0.69, 0.4), py(0.69, 0.4, TOP), 34, 15, '#7c8189', 0.7),
      E(px(0.69, 0.4), py(0.69, 0.4, TOP), 22, 9, '#9aa0a7', 0.6),
    ];
    const bars = [];
    for (const a of [0.32, 0.5, 0.68]) for (const b of [0.32, 0.5, 0.68]) {
      const [x, y] = pt(a, b, TOP);
      bars.push(PG(P([[x - 1.2, y], [x - 1.2, y - 30], [x + 1.2, y - 30], [x + 1.2, y]]), '#7d5027'));
      bars.push(PG(P([[x - 1.2, y - 30], [x - 1.2, y - 33], [x + 1.2, y - 33], [x + 1.2, y - 30]]), '#a86b12'));
    }

    // ---- props
    const shadow = (x, y, r) => E(x, y, r, r * 0.42, '#35691b', 0.32);
    const tree = (gx, gy, k) => [
      shadow(gx, gy, 34 * k),
      PG(P([[gx - 4 * k, gy], [gx - 4 * k, gy - 50 * k], [gx + 4 * k, gy - 50 * k], [gx + 4 * k, gy]]), '#8a5a2f'),
      PG(P([[gx, gy], [gx, gy - 50 * k], [gx + 4 * k, gy - 50 * k], [gx + 4 * k, gy]]), '#6b4522'),
      E(gx - 8 * k, gy - 62 * k, 30 * k, 30 * k, '#3f7a20'),
      E(gx + 4 * k, gy - 70 * k, 31 * k, 31 * k, '#4b8f26'),
      E(gx - 6 * k, gy - 80 * k, 20 * k, 20 * k, '#59a52e'),
      E(gx + 12 * k, gy - 84 * k, 13 * k, 13 * k, '#7cc945'),
      E(gx + 16 * k, gy - 90 * k, 5 * k, 5 * k, '#8fd65a'),
    ];
    const bush = (gx, gy, k) => [
      shadow(gx, gy + 2 * k, 24 * k),
      E(gx - 3 * k, gy - 10 * k, 23 * k, 16 * k, '#3f7a20'),
      E(gx + 2 * k, gy - 13 * k, 20 * k, 14 * k, '#4b8f26'),
      E(gx + 7 * k, gy - 19 * k, 10 * k, 6 * k, '#7cc945'),
    ];
    const clump = (x, y, k) => {
      const back = [[-9, 0], [-7, -9], [-4, 0], [-2, -13], [1, 0], [4, -11], [7, 0], [9, -7], [11, 0]];
      const front = [[-5, 0], [-3, -16], [-1, 0], [1, -19], [3, 0], [6, -14], [8, 0]];
      return [PG(P(back.map(([dx, dy]) => [x + dx * k, y + dy * k])), '#3f7a20'), PG(P(front.map(([dx, dy]) => [x + dx * k, y + dy * k])), '#8fd65a')];
    };
    const flower = (x, y, h, col) => [
      PG(P([[x - 0.8, y], [x - 0.8, y - h], [x + 0.8, y - h], [x + 0.8, y]]), '#3f7a20'),
      E(x, y - h, 3.6, 3.6, col), E(x, y - h, 1.4, 1.4, '#f2dc9a'),
    ];
    const heap = (gx, gy, k, cols) => [
      E(gx, gy + 2, 30 * k, 12 * k, '#35691b', 0.3),
      E(gx, gy - 6 * k, 28 * k, 14 * k, cols[2]),
      E(gx + 4 * k, gy - 9 * k, 22 * k, 11 * k, cols[1]),
      E(gx + 8 * k, gy - 13 * k, 11 * k, 5 * k, cols[0]),
    ];
    const bags = (a, b) => {
      const BAG = ['#efe6d7', '#d8d0c0', '#b8b0a2'], out = [E(px(a + 0.03, b + 0.03), py(a + 0.03, b + 0.03) + 2, 26, 11, '#35691b', 0.3)];
      for (let i = 0; i < 3; i++) out.push(...box(a, b + i * 0.03, a + 0.06, b + i * 0.03 + 0.028, 0, 9, BAG));
      for (let i = 0; i < 2; i++) out.push(...box(a + 0.003, b + 0.015 + i * 0.03, a + 0.057, b + 0.043 + i * 0.03, 9, 18, BAG));
      out.push(...box(a + 0.006, b + 0.03, a + 0.054, b + 0.058, 18, 27, BAG));
      out.push(PG(P([pt(a + 0.006, b + 0.03, 24), pt(a + 0.054, b + 0.03, 24), pt(a + 0.054, b + 0.03, 21), pt(a + 0.006, b + 0.03, 21)]), '#9184d9'));
      return out;
    };
    const barrow = (a, b) => {
      const [wx, wy] = pt(a + 0.085, b + 0.03, 0);
      return [
        E(px(a + 0.045, b + 0.03), py(a + 0.045, b + 0.03) + 2, 34, 14, '#35691b', 0.3),
        ...box(a - 0.01, b + 0.008, a + 0.005, b + 0.016, 6, 16, ['#7c8189', '#5d6170', '#3f424d']),
        ...box(a - 0.01, b + 0.044, a + 0.005, b + 0.052, 6, 16, ['#7c8189', '#5d6170', '#3f424d']),
        ...box(a + 0.005, b, a + 0.085, b + 0.06, 14, 32, ['#f6c445', '#dc9a1f', '#a86b12']),
        E(px(a + 0.045, b + 0.03), py(a + 0.045, b + 0.03, 32), 18, 8, '#8e939a'),
        E(px(a + 0.048, b + 0.028), py(a + 0.048, b + 0.028, 33), 9, 3.5, '#a3a7ad'),
        E(wx, wy - 8, 8, 8, '#2b2e3a'), E(wx, wy - 8, 3, 3, '#5d6170'),
      ];
    };
    // mixer truck parked along the +a edge, facing +b; drum aft, chute swung over the wet half
    const YEL = ['#f6c445', '#dc9a1f', '#a86b12'], TRK = ['#4a4e5b', '#2b2e3a', '#232634'], DRK = ['#5d6170', '#3f424d', '#2b2e3a'], GLS = ['#f6c445', '#3a5f7a', '#2f4f66'], STL = ['#b0b6bd', '#9aa0a7', '#7c8189'];
    const truck = () => {
      const a0 = 0.85, a1 = 0.97, b0 = 0.36, b1 = 0.74, out = [];
      out.push(E(px(0.91, 0.55), py(0.91, 0.55) + 4, 88, 42, '#35691b', 0.35));
      const wheel = (aa, bb) => [...box(aa, bb, aa + 0.022, bb + 0.05, 0, 16, TRK), E(px(aa + 0.022, bb + 0.025), py(aa + 0.022, bb + 0.025, 8), 5, 8, '#5d6170'), E(px(aa + 0.022, bb + 0.025), py(aa + 0.022, bb + 0.025, 8), 2, 3.2, '#8e939a')];
      for (const bb of [0.4, 0.49, 0.65]) out.push(...wheel(a0 - 0.004, bb));
      out.push(...box(a0, b0, a1, b1, 12, 24, DRK));                                 // chassis
      out.push(...box(a0 + 0.008, b0, a1 - 0.008, b0 + 0.035, 24, 58, DRK));          // rear hopper frame
      out.push(...box(a0 + 0.012, b0 + 0.035, a1 - 0.012, b0 + 0.27, 24, 42, YEL));   // drum tiers (octagonal profile)
      out.push(...box(a0 + 0.026, b0 + 0.028, a1 - 0.026, b0 + 0.278, 42, 64, YEL));
      out.push(...box(a0 + 0.042, b0 + 0.04, a1 - 0.042, b0 + 0.265, 64, 74, ['#f9d56a', '#f6c445', '#dc9a1f']));
      out.push(PG(P([pt(a1 - 0.026, b0 + 0.11, 64), pt(a1 - 0.026, b0 + 0.15, 64), pt(a1 - 0.026, b0 + 0.21, 42), pt(a1 - 0.026, b0 + 0.17, 42)]), '#a86b12')); // stripe on lit face
      out.push(PG(P([pt(a1 - 0.012, b0 + 0.12, 42), pt(a1 - 0.012, b0 + 0.16, 42), pt(a1 - 0.012, b0 + 0.22, 24), pt(a1 - 0.012, b0 + 0.18, 24)]), '#a86b12'));
      out.push(...box(a0 + 0.02, b0 + 0.012, a1 - 0.02, b0 + 0.03, 58, 66, STL));     // drum hatch cap
      out.push(...box(a0, b1 - 0.11, a1, b1, 24, 40, YEL));                           // cab lower
      out.push(...box(a0 + 0.006, b1 - 0.105, a1 - 0.006, b1 - 0.006, 40, 64, GLS));  // cab glass
      out.push(...box(a0, b1 - 0.11, a1, b1, 64, 70, YEL));                           // cab roof
      out.push(...box(a0 + 0.02, b1 - 0.02, a1 - 0.02, b1 + 0.012, 18, 30, DRK));     // bumper
      for (const bb of [0.4, 0.49, 0.65]) out.push(...wheel(a1 - 0.018, bb));
      out.push(...box(a0 + 0.03, b1 - 0.145, a1 - 0.03, b1 - 0.11, 24, 50, ['#7c8189', '#5d6170', '#3f424d'])); // exhaust stack
      // chute: from the hopper down to the slab, two faces
      const c0 = [a0 + 0.02, b0 + 0.012, 54], c1 = [0.75, b0 + 0.012, TOP + 6], w = 0.013;
      out.push(PG(P([pt(c0[0], c0[1] - w, c0[2]), pt(c0[0], c0[1] + w, c0[2]), pt(c1[0], c1[1] + w, c1[2]), pt(c1[0], c1[1] - w, c1[2])]), '#9aa0a7'));
      out.push(PG(P([pt(c0[0], c0[1] + w, c0[2]), pt(c0[0], c0[1] + w, c0[2] - 6), pt(c1[0], c1[1] + w, c1[2] - 6), pt(c1[0], c1[1] + w, c1[2])]), '#7c8189'));
      out.push(PG(P([pt(c0[0], c0[1] - w, c0[2]), pt(c0[0], c0[1] - w, c0[2] - 6), pt(c1[0], c1[1] - w, c1[2] - 6), pt(c1[0], c1[1] - w, c1[2])]), '#b0b6bd'));
      return out;
    };

    let s = 3;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const items = [];
    const at = (a, b, fn, ...rest) => ({ d: a + b, shapes: fn(px(a, b), py(a, b), ...rest) });
    const outside = (a, b) => (a < 0.16 || a > 0.84 || b < 0.16 || b > 0.84) && !(a > 0.8 && b > 0.42 && b < 0.6) && !(a < 0.3 && b < 0.3);
    for (let i = 0; i < 44; i++) {
      const a = 0.06 + rnd() * 0.88, b = 0.06 + rnd() * 0.88, k = 0.7 + rnd() * 0.6;
      if (false && outside(a, b)) items.push({ d: a + b, shapes: clump(px(a, b), py(a, b), k) });
    }
    const petals = ['#efe6d7', '#b5abfc', '#f2dc9a', '#e7a3b4'];
    for (let i = 0; i < 6; i++) {
      const a = 0.08 + rnd() * 0.84, b = 0.08 + rnd() * 0.84;
      if (true || !outside(a, b)) continue;
      const x = px(a, b), y = py(a, b), col = petals[i % 4];
      items.push({ d: a + b, shapes: [...flower(x - 6, y + 1, 13, col), ...flower(x + 2, y - 2, 16, col), ...flower(x + 8, y + 2, 11, col)] });
    }
    items.push(at(0.09, 0.56, heap, 0.9, ['#e3cfa3', '#c9a97a', '#b98553']));
    items.push(at(0.1, 0.74, heap, 0.75, ['#b0b6bd', '#9aa0a7', '#7c8189']));
    items.push({ d: 1.0, shapes: bags(0.86, 0.1) });
    items.push({ d: 1.58, shapes: barrow(0.66, 0.88) });
    items.push({ d: 1.46, shapes: truck() });
    items.push({ d: 1.0, shapes: [...pit, ...formBack, ...slab, ...formFront, ...stakes, ...bars] });
    items.sort((p, q) => p.d - q.d);
    const scene = items.flatMap(it => it.shapes);

    // live layer: wet-concrete sheen + chute drip (createElement so the animation survives re-renders)
    const h = React.createElement;
    const [sx, sy] = pt(0.6, 0.6, TOP);
    const [dx, dy] = pt(0.75, 0.372, TOP + 4);
    const live = h('g', null,
      h('ellipse', { cx: r1(sx), cy: r1(sy), rx: 40, ry: 17, fill: '#c3c7cc', style: { animation: 'sheen 3s ease-in-out infinite' } }),
      h('ellipse', { cx: r1(sx + 26), cy: r1(sy - 18), rx: 16, ry: 6, fill: '#d6d9dd', style: { animation: 'sheen 3s ease-in-out 1.2s infinite' } }),
      h('ellipse', { cx: r1(dx), cy: r1(dy - 6), rx: 3.5, ry: 5, fill: '#9aa0a7', style: { animation: 'drip 1.2s ease-in infinite' } }),
      h('ellipse', { cx: r1(dx - 2), cy: r1(dy - 6), rx: 3, ry: 4, fill: '#b0b6bd', style: { animation: 'drip 1.2s ease-in .6s infinite' } }),
    );
    return { doc: !this.props.tile, wrapPad: this.props.tile ? '0' : '48px 24px 80px', fringe, stripes, track, scene, live };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S(J(v,["max-width:920px;margin:0 auto;padding:", " wrapPad ", ""])), "data-tile-wrap": "1"}, "\n  ", (R(v," doc ") ? ["\n  ", h("h1", {"style": S("font-weight:500;font-size:26px;letter-spacing:-.01em;margin:0 0 6px")}, "Isometric plot — foundation"), "\n  ", h("p", {"style": S("color:#9a9aa5;margin:0 0 28px")}, "Stage 3 of the ladder — the plot is level and green again; the villa footprint has been dug out, boxed in timber formwork, and the concrete slab is being poured. Hand this whole file to a coding agent. Previous stage: ", h("a", {"href": "Isometric Grading - reference for Claude Code.html"}, "grading"), "."), "\n\n  "] : null), "\n  ", h("svg", {"viewBox": "0 -60 820 700", "style": S("width:100%;height:auto;display:block")}, "\n    ", h("polygon", {"points": "410,100 794.5,322 410,544 25.5,322", "fill": "#232739"}), "\n    ", h("polygon", {"points": "794.5,322 410,544 410,595 794.5,373", "fill": "#1b1e2c"}), "\n    ", h("polygon", {"points": "410,544 25.5,322 25.5,373 410,595", "fill": "#12141d"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,516 721.8,336", "fill": "#8a5a33"}), "\n    ", h("polygon", {"points": "410,444 98.2,264 98.2,336 410,516", "fill": "#6d4527"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,458 721.8,278", "fill": "#3f2a18", "opacity": "0.35"}), "\n    ", h("polygon", {"points": "721.8,250 410,430 410,444 721.8,264", "fill": "#59a52e"}), "\n    ", h("polygon", {"points": "410,430 98.2,250 98.2,264 410,444", "fill": "#3f7a20"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," fringe ")).map((it, i) => (v => [h("polygon", {"points": R(v," f.pts "), "fill": R(v," f.fill ")})])({...v, "f": it, $index: i}))), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "#6cba36"}), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "none", "stroke": "#3f7a20", "stroke-width": "8"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," stripes ")).map((it, i) => (v => [h("polygon", {"points": R(v," s.pts "), "fill": "#74c43c", "opacity": "0.4"})])({...v, "s": it, $index: i}))), "\n    ", "\n    ", h("polygon", {"points": R(v," track "), "fill": "#8a5a33", "opacity": "0.32"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," scene ")).map((it, i) => (v => ["\n      ", (R(v," t.isPoly ") ? [h("polygon", {"points": R(v," t.pts "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n      ", (R(v," t.isEllipse ") ? [h("ellipse", {"cx": R(v," t.cx "), "cy": R(v," t.cy "), "rx": R(v," t.rx "), "ry": R(v," t.ry "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n    "])({...v, "t": it, $index: i}))), ...T(v,["\n    ", " live ", "\n  "])), "\n  ", (R(v," doc ") ? ["\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "What this asset is"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "The plot after grading, at the foundation pour. Base plinth, soil skirt, grass top and boundary stroke are byte-identical to the plot parcel — the meadow has been re-seeded flat, so the whole top is grass again. Only the footprint is disturbed."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Footprint: pit ", h("code", {}, "a,b ∈ [0.2, 0.8]"), ", 14px deep, showing the two far inner walls (soil, lit/shaded) and a compacted hardcore floor. Timber formwork boxes the pit rim on all four sides with stakes outside it. The slab ", h("code", {}, "a,b ∈ [0.235, 0.765]"), " rises from the floor to 6px above grade; its back half is set (", h("code", {}, "#b0b4ba"), "), its front half is fresh pour (", h("code", {}, "#8e939a"), ") with a breathing sheen. Nine rust starter bars stand on a 3×3 grid where the villa's columns will land."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Site props: a mixer truck parked along the ", h("code", {}, "+a"), " edge (cab facing ", h("code", {}, "+b"), ", octagonal drum with a dark stripe, hopper aft, steel chute running straight in ", h("code", {}, "−a"), " onto the wet half), a wheelbarrow at the front-left corner, a stack of cement bags at the back-right, a sand heap and a gravel heap on the back-left, a worn access track from the +a edge. All planting has been cleared — no trees, bushes, clumps or flowers; the lawn is a clean mown surface."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Next stage: ", h("code", {}, "Isometric Construction"), " (walls rise from the starter bars) → villa."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Geometry rules"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "One fixed 2:1 isometric diamond: ", h("code", {}, "(a,b,h) → (410 + (a−b)·311.8, 70 + (a+b)·180 − h)"), ". Height is a vertical offset only; depth is a negative height. Never rotate or skew geometry."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Every solid is an axis-aligned iso box: top face at ", h("code", {}, "h1"), ", ", h("code", {}, "+a"), " face lit, ", h("code", {}, "+b"), " face shaded — one hue, three values. The pit is the inverse: floor at ", h("code", {}, "−D"), ", and only the ", h("code", {}, "a = a0"), " and ", h("code", {}, "b = b0"), " inner walls are visible."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Concrete ", h("code", {}, "#b0b4ba / #9aa0a7 / #7c8189"), " (set) and ", h("code", {}, "#8e939a"), " (wet); timber ", h("code", {}, "#c9a97a / #a97140 / #8a5a2f"), "; rebar ", h("code", {}, "#a86b12"), " over ", h("code", {}, "#7d5027"), "; machine yellow ", h("code", {}, "#f6c445 / #dc9a1f / #a86b12"), "; hardcore ", h("code", {}, "#6b6157"), "."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Paint order"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Plinth → soil skirt → edge bands + fringe → grass top + boundary → mowing stripes → access track → everything else sorted by ", h("code", {}, "a + b"), ": back props → pit floor → far inner walls → back formwork → slab (set half, wet half) → front formwork + stakes → starter bars → front props → live layer (sheen, chute drip)."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Strokes only for the parcel boundary. Flat polygons and ellipses; no gradients."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Prompt that works"), "\n  ", h("pre", {"style": S("background:#1e2130;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:12px;color:#c9c6da;margin:0;white-space:pre-wrap")}, "Draw an isometric grass plot with a freshly poured concrete foundation\nas inline SVG, no libraries.\n\nProjection: fixed 2:1 isometric. Tile coords a,b in [0,1] map to\nx = 410 + (a-b)*311.8, y = 70 + (a+b)*180 - h. Never rotate or skew.\n\nBase identical to the plot parcel: grass top #6cba36, 8px #3f7a20\nboundary stroke, faint mowing stripes.\n\nFootprint a,b in [0.2,0.8]: a 14px-deep pit (hardcore floor #6b6157,\nfar inner walls soil #8a5a33 lit / #6d4527 shaded), timber formwork\nboards on all four rims with stakes, a concrete slab a,b in\n[0.235,0.765] rising to 6px above grade — back half set #b0b4ba,\nfront half wet #8e939a with a soft sheen — and 9 rust starter bars\non a 3x3 grid.\n\nProps on the grass: mixer truck along the +a edge built only from iso\nboxes (six wheels, dark chassis, yellow #f6c445 cab with glass, 3-tier\noctagonal drum with #a86b12 stripe, aft hopper, steel chute straight\nin -a onto the wet half), wheelbarrow, cement bag stack, sand and\ngravel heaps, a worn access track from the +a edge. No trees, bushes,\ngrass clumps or flowers.\n\nPaint back-to-front by a+b. Flat polygons and ellipses only. No\ngradients. No strokes for shading."), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Reuse"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Copy the ", h("code", {}, "<svg>"), " block plus the three ", h("code", {}, "@keyframes"), ". For a static board tile drop the animations — the silhouette reads on its own."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "On a grid tile: ", h("code", {}, "<g transform=\"translate(TX,TY) scale(S) translate(-410,-250)\">"), " — same wrapper as the plot, grading and villa."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "To animate progress, sweep the wet/set split from ", h("code", {}, "a = 0.765"), " back to ", h("code", {}, "0.235"), "; when it reaches the back, the construction stage begins and walls rise from the starter bars."), "\n  ")] : null))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n    body { margin:0; background:transparent; color:#e9e9ed; font:14px/1.5 Inter, system-ui, sans-serif; }\n    a { color:#b5abfc; } a:hover { color:#d2cefd; }\n    @keyframes sheen { 0%,100% { opacity:.25 } 50% { opacity:.6 } }\n    @keyframes drum { 0%,100% { transform:translate(0,0) } 50% { transform:translate(0,-1.2px) } }\n    @keyframes drip { 0% { opacity:0; transform:translate(0,0) } 30% { opacity:.9 } 100% { opacity:0; transform:translate(0,14px) } }\n  "}];
export default defineDC("part-stage-foundation", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
