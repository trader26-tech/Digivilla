import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber } from './rt.js?v=d022af0c';
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {
  renderVals() {
    const W = 311.8, H = 180;
    const px = (a, b) => 410 + (a - b) * W, py = (a, b) => 70 + (a + b) * H;
    const r1 = n => Math.round(n * 10) / 10;
    // fringe along the two front grass edges (same as villa)
    const fringe = [];
    for (let i = 0; i < 8; i++) {
      const x = 688.2 - i * 37.45, y = 283.4 + i * 21.6;
      fringe.push({ pts: `${r1(x)},${r1(y)} ${r1(x + 17.4)},${r1(y - 10)} ${r1(x + 8.7)},${r1(y + 10)}`, fill: '#59a52e' });
      const lx = 376.4 - i * 37.45, ly = 424.6 - i * 21.6;
      fringe.push({ pts: `${r1(lx)},${r1(ly)} ${r1(lx + 17.4)},${r1(ly + 10)} ${r1(lx + 8.7)},${r1(ly + 20)}`, fill: '#3f7a20' });
    }
    const P = arr => arr.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
    // one iso solid = 3 polygons: right (lit), left (shaded), top
    const solid = (gx, gy, hw, h, cols) => {
      const hh = hw * 0.577;
      return [
        { pts: P([[gx + hw, gy - hh - h], [gx, gy - h], [gx, gy], [gx + hw, gy - hh]]), fill: cols[1] },
        { pts: P([[gx, gy - h], [gx - hw, gy - hh - h], [gx - hw, gy - hh], [gx, gy]]), fill: cols[2] },
        { pts: P([[gx, gy - 2 * hh - h], [gx + hw, gy - hh - h], [gx, gy - h], [gx - hw, gy - hh - h]]), fill: cols[0] },
      ];
    };
    const E = (cx, cy, rx, ry, fill, op = 1) => ({ isEllipse: true, cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, op });
    const PG = (pts, fill, op = 1) => ({ isPoly: true, pts, fill, op });
    // mowing stripes across the a-axis
    const stripes = [];
    for (let b0 = 0.05; b0 < 0.95; b0 += 0.2) {
      const b1 = Math.min(b0 + 0.1, 0.97);
      stripes.push({ pts: P([[px(0.03, b0), py(0.03, b0)], [px(0.97, b0), py(0.97, b0)], [px(0.97, b1), py(0.97, b1)], [px(0.03, b1), py(0.03, b1)]]) });
    }
    const shadow = (x, y, r) => E(x, y, r, r * 0.42, '#35691b', 0.32);
    // tree: soft shadow, trunk, three-value round canopy
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
    // bush: shadow, shaded body, lit body, highlight, berries
    const bush = (gx, gy, k, berries) => [
      shadow(gx, gy + 2 * k, 24 * k),
      E(gx - 3 * k, gy - 10 * k, 23 * k, 16 * k, '#3f7a20'),
      E(gx + 2 * k, gy - 13 * k, 20 * k, 14 * k, '#4b8f26'),
      E(gx + 7 * k, gy - 19 * k, 10 * k, 6 * k, '#7cc945'),
      ...(berries ? [E(gx - 9 * k, gy - 12 * k, 2.2, 2.2, berries), E(gx + 3 * k, gy - 6 * k, 2.2, 2.2, berries), E(gx + 12 * k, gy - 14 * k, 2.2, 2.2, berries)] : []),
    ];
    const stone = (gx, gy, k) => [
      shadow(gx, gy + 1, 10 * k),
      E(gx, gy - 4 * k, 9 * k, 5.5 * k, '#7c8189'),
      E(gx + 1 * k, gy - 5 * k, 7 * k, 4 * k, '#9aa0a7'),
      E(gx + 3 * k, gy - 6.5 * k, 3.5 * k, 1.8 * k, '#b0b6bd'),
    ];
    // pond: grass rim, water, lit water, sparkle, lily pad
    const pond = (gx, gy) => [
      E(gx, gy, 62, 36, '#43861f'),
      E(gx, gy, 56, 32, '#2f4f66'),
      E(gx + 3, gy - 2, 50, 28, '#3a5f7a'),
      E(gx + 8, gy - 6, 36, 18, '#4fb9cc', 0.75),
      E(gx + 18, gy - 12, 12, 3.5, '#c9e8ee', 0.7),
      E(gx - 22, gy + 8, 6, 3.6, '#59a52e'),
      E(gx - 22, gy + 7, 1.8, 1.8, '#e7a3b4'),
      E(gx - 12, gy + 14, 4.5, 2.7, '#59a52e'),
    ];
    const reeds = (x, y) => [
      PG(P([[x - 1, y], [x - 3, y - 26], [x - 1, y - 26], [x + 1, y]]), '#3f7a20'),
      PG(P([[x + 4, y], [x + 4, y - 32], [x + 6, y - 32], [x + 6, y]]), '#4b8f26'),
      E(x + 5, y - 33, 2, 5, '#8a5a2f'),
      PG(P([[x + 10, y], [x + 11, y - 22], [x + 13, y - 22], [x + 12, y]]), '#3f7a20'),
    ];
    // clump: dark wide blades behind, lighter tall blades in front
    const clump = (x, y, k) => {
      const back = [[-9, 0], [-7, -9], [-4, 0], [-2, -13], [1, 0], [4, -11], [7, 0], [9, -7], [11, 0]];
      const front = [[-5, 0], [-3, -16], [-1, 0], [1, -19], [3, 0], [6, -14], [8, 0]];
      return [
        PG(P(back.map(([dx, dy]) => [x + dx * k, y + dy * k])), '#3f7a20'),
        PG(P(front.map(([dx, dy]) => [x + dx * k, y + dy * k])), '#8fd65a'),
      ];
    };
    // flower: stem, two leaves, round head, centre
    const flower = (x, y, h, col) => [
      PG(P([[x - 0.8, y], [x - 0.8, y - h], [x + 0.8, y - h], [x + 0.8, y]]), '#3f7a20'),
      E(x - 3, y - h * 0.45, 3, 1.4, '#4b8f26'),
      E(x, y - h, 3.8, 3.8, col),
      E(x, y - h, 1.5, 1.5, '#f2dc9a'),
    ];
    // seeded scatter, sorted back-to-front by a+b
    let s = 11;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const clear = (a, b) =>
      (a > 0.78 && b > 0.5 && b < 0.76) ||           // sign
      (a < 0.34 && b < 0.34) ||                       // tree
      (a > 0.22 && a < 0.56 && b > 0.5 && b < 0.9);   // pond
    const items = [];
    for (let i = 0; i < 34; i++) {
      const a = 0.07 + rnd() * 0.86, b = 0.07 + rnd() * 0.86, k = 0.7 + rnd() * 0.6;
      if (clear(a, b)) continue;
      items.push({ d: a + b, shapes: clump(px(a, b), py(a, b), k) });
    }
    const petals = ['#efe6d7', '#b5abfc', '#f2dc9a', '#e7a3b4', '#d2cefd'];
    for (let i = 0; i < 9; i++) {
      const a = 0.1 + rnd() * 0.8, b = 0.1 + rnd() * 0.8;
      if (clear(a, b)) continue;
      const x = px(a, b), y = py(a, b), col = petals[i % petals.length];
      items.push({ d: a + b, shapes: [
        ...flower(x - 8, y + 2, 13 + rnd() * 4, col),
        ...flower(x + 1, y - 3, 17 + rnd() * 4, col),
        ...flower(x + 9, y + 1, 12 + rnd() * 4, col),
        ...flower(x + 3, y + 5, 9 + rnd() * 3, col),
      ] });
    }
    const at = (a, b, fn, ...rest) => ({ d: a + b, shapes: fn(px(a, b), py(a, b), ...rest) });
    items.push(at(0.18, 0.18, tree, 1.15));
    items.push(at(0.9, 0.1, tree, 0.8));
    items.push(at(0.12, 0.6, bush, 1, '#e7a3b4'));
    items.push(at(0.8, 0.34, bush, 1.15, null));
    items.push(at(0.62, 0.86, bush, 0.8, '#f2dc9a'));
    items.push(at(0.86, 0.84, bush, 0.7, null));
    items.push(at(0.4, 0.7, pond));
    items.push(at(0.24, 0.62, reeds));
    items.push(at(0.56, 0.62, reeds));
    items.push(at(0.6, 0.78, stone, 1));
    items.push(at(0.5, 0.12, stone, 0.8));
    items.sort((p, q) => p.d - q.d);
    const flora = items.flatMap(it => it.shapes);
    return { doc: !this.props.tile, wrapPad: this.props.tile ? '0' : '48px 24px 80px', fringe, stripes, flora };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S(J(v,["max-width:920px;margin:0 auto;padding:", " wrapPad ", ""])), "data-tile-wrap": "1"}, "\n  ", (R(v," doc ") ? ["\n  ", h("h1", {"style": S("font-weight:500;font-size:26px;letter-spacing:-.01em;margin:0 0 6px")}, "Isometric plot parcel"), "\n  ", h("p", {"style": S("color:#9a9aa5;margin:0 0 28px")}, "Stage 1 of the ladder — the empty grass plot a broker pitches before anything is built. Same base as the villa; only the structures differ. Hand this whole file to a coding agent."), "\n\n  "] : null), "\n  ", h("svg", {"viewBox": "0 -60 820 700", "style": S("width:100%;height:auto;display:block")}, "\n    ", h("polygon", {"points": "410,100 794.5,322 410,544 25.5,322", "fill": "#232739"}), "\n    ", h("polygon", {"points": "794.5,322 410,544 410,595 794.5,373", "fill": "#1b1e2c"}), "\n    ", h("polygon", {"points": "410,544 25.5,322 25.5,373 410,595", "fill": "#12141d"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,516 721.8,336", "fill": "#8a5a33"}), "\n    ", h("polygon", {"points": "410,444 98.2,264 98.2,336 410,516", "fill": "#6d4527"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,458 721.8,278", "fill": "#3f2a18", "opacity": "0.35"}), "\n    ", h("polygon", {"points": "721.8,250 410,430 410,444 721.8,264", "fill": "#59a52e"}), "\n    ", h("polygon", {"points": "410,430 98.2,250 98.2,264 410,444", "fill": "#3f7a20"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," fringe ")).map((it, i) => (v => [h("polygon", {"points": R(v," f.pts "), "fill": R(v," f.fill ")})])({...v, "f": it, $index: i}))), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "#6cba36"}), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "none", "stroke": "#3f7a20", "stroke-width": "8"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," stripes ")).map((it, i) => (v => [h("polygon", {"points": R(v," s.pts "), "fill": "#74c43c", "opacity": "0.4"})])({...v, "s": it, $index: i}))), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," flora ")).map((it, i) => (v => ["\n      ", (R(v," t.isPoly ") ? [h("polygon", {"points": R(v," t.pts "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n      ", (R(v," t.isEllipse ") ? [h("ellipse", {"cx": R(v," t.cx "), "cy": R(v," t.cy "), "rx": R(v," t.rx "), "ry": R(v," t.ry "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n    "])({...v, "t": it, $index: i}))), "\n    ", h("ellipse", {"cx": "497.3", "cy": "343.6", "rx": "30", "ry": "11", "fill": "#35691b", "opacity": "0.35"}), "\n    ", "\n    ", h("rect", {"x": "493.8", "y": "271.6", "width": "7", "height": "72", "fill": "#8a5a2f"}), "\n    ", h("polygon", {"points": "467.3,297 463.8,299 463.8,333 467.3,331", "fill": "#7d5027"}), "\n    ", h("polygon", {"points": "467.3,297 527.3,262.4 527.3,296.4 467.3,331", "fill": "#a97140"}), "\n    ", h("polygon", {"points": "470.3,300.7 524.3,269.5 524.3,292.7 470.3,323.9", "fill": "#efe6d7"}), "\n    ", h("text", {"transform": "translate(473.5,312.5) skewY(-30)", "font-family": "Inter, system-ui, sans-serif", "font-weight": "600", "font-size": "10.5", "letter-spacing": "0.6", "fill": "#5c3a1c", "textLength": "48", "lengthAdjust": "spacingAndGlyphs"}, "FOR SALE"), "\n    ", h("polygon", {"points": "473.5,316.6 508.5,296.4 508.5,298.6 473.5,318.8", "fill": "#9184d9"}), "\n  "), "\n  ", (R(v," doc ") ? ["\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "What this asset is"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "The ", h("b", {}, "Plot"), " tier (₹10L, 100% equity). Base geometry — plinth, soil skirt, grass top, boundary stroke — is byte-identical to the villa parcel, so the two sit side by side on the same grid with no seam."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "No fence, no paths, no structures. What reads as \"empty land\": a darker mown patch, a worn dirt patch, faint mowing stripes, two-tone grass clumps, wildflower clusters (cream, lavender, pale yellow, pink), two round-canopy trees at the back corners, a small pond with reeds and lily pads, four rounded bushes with soft ground shadows, two stones, and a wooden FOR SALE board on a post at the front-right corner. The board text is the one place a ", h("code", {}, "skewY(-30)"), " is allowed — it lays type onto the lit face; geometry itself is never skewed."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Progression: plot → (add scaffold + shell from the construction reference) → villa. Keep the base; swap only what sits on the grass."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "The projection (this is the part agents get wrong)"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "One fixed 2:1 isometric diamond. Half-width ", h("code", {}, "W = 311.8"), ", half-height ", h("code", {}, "H = 180"), ", grass top centred at ", h("code", {}, "(410, 250)"), ". Corners top/right/bottom/left = ", h("code", {}, "(410,70) (721.8,250) (410,430) (98.2,250)"), "."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Place anything on the grass with tile coords ", h("code", {}, "a, b ∈ [0,1]"), ": ", h("code", {}, "x = 410 + (a − b)·311.8"), ", ", h("code", {}, "y = 70 + (a + b)·180"), ". Height is a pure vertical offset (subtract from y). Never rotate, never skew."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Every solid (shrub, stone) is three polygons: top diamond, right face lit, left face shaded — one hue, three values."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Scatter tufts with a seeded generator and sort by ", h("code", {}, "a + b"), " ascending before painting; don't hand-place them."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Paint order"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Plinth sides → soil sides → soil shadow → grass edge bands + fringe → grass top → boundary stroke → ground patches → tufts, shrubs, stones (sorted back-to-front) → sign post → board → board text slabs."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Strokes only for the parcel boundary. No gradients, no shading strokes."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Prompt that works"), "\n  ", h("pre", {"style": S("background:#1e2130;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:12px;color:#c9c6da;margin:0;white-space:pre-wrap")}, "Draw an isometric empty grass plot as inline SVG, no libraries.\n\nProjection: fixed 2:1 isometric. Half-width W=311.8, half-height H=180,\ngrass top centred at (410,250). Tile coords a,b in [0,1] map to\nx = 410 + (a-b)*311.8, y = 70 + (a+b)*180. Height = vertical y offset\nonly; never rotate or skew.\n\nBase (identical to the villa parcel): plinth #232739/#1b1e2c/#12141d,\nsoil #8a5a33 right / #6d4527 left, grass top #6cba36 with an 8px\n#3f7a20 boundary stroke, edge bands #59a52e / #3f7a20.\n\nOn the grass: one darker mown diamond (#43861f @ .55), one worn dirt\ndiamond (#8a5a33 @ .32), ~26 grass tufts from a seeded generator\n(7-point blade polygons, #4b8f26 / #3f7a20), two low shrubs and two\nstones as 3-polygon solids, one wooden board on a post at a=0.9,b=0.62.\n\nNo fence, paths or structures. Paint back-to-front sorted by a+b.\nFlat polygons only. No gradients. No strokes for shading."), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Reuse"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Copy the ", h("code", {}, "<svg>"), " block — self-contained, no CSS or JS."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "On a grid tile: ", h("code", {}, "<g transform=\"translate(TX,TY) scale(S) translate(-410,-250)\">"), " — same wrapper as the villa, so the footprint lands on the same cell."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "For the Explore overview slide, float it with a slow 6s bob over the green radial glow; the board is the tap target for \"Full sheet →\"."), "\n  ")] : null))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n    body { margin:0; background:transparent; color:#e9e9ed; font:14px/1.5 Inter, system-ui, sans-serif; }\n    a { color:#b5abfc; } a:hover { color:#d2cefd; }\n    @keyframes bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }\n  "}];
export default defineDC("part-stage-plot", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
