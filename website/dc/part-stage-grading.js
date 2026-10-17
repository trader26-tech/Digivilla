import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready, smoothScroll, scrubber, pageGestures } from './rt.js?v=61559ef6';
/* ── logic, verbatim from the design file ── */
class Component extends DCLogic {
  renderVals() {
    const W = 311.8, H = 180, SPLIT = 0.42;
    const px = (a, b) => 410 + (a - b) * W, py = (a, b, h = 0) => 70 + (a + b) * H - h;
    const r1 = n => Math.round(n * 10) / 10;
    const P = arr => arr.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
    const E = (cx, cy, rx, ry, fill, op = 1) => ({ isEllipse: true, cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, op });
    const PG = (pts, fill, op = 1) => ({ isPoly: true, pts, fill, op });
    const pt = (a, b, h) => [px(a, b), py(a, b, h)];

    // fringe: soil-coloured on the +a edge, grass only on the meadow part of the +b edge
    const fringe = [];
    for (let i = 0; i < 8; i++) {
      const x = 688.2 - i * 37.45, y = 283.4 + i * 21.6;
      fringe.push({ pts: P([[x, y], [x + 17.4, y - 10], [x + 8.7, y + 10]]), fill: '#8a5a33' });
      const lx = 376.4 - i * 37.45, ly = 424.6 - i * 21.6;
      fringe.push({ pts: P([[lx, ly], [lx + 17.4, ly + 10], [lx + 8.7, ly + 20]]), fill: i >= 5 ? '#3f7a20' : '#6d4527' });
    }
    // meadow polygon with jittered sod edge
    let s = 5;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const edge = [];
    for (let i = 0; i <= 12; i++) edge.push([SPLIT + (i === 0 || i === 12 ? 0 : (rnd() - 0.5) * 0.05), i / 12]);
    const meadow = P([pt(0, 0, 0), ...edge.map(([a, b]) => pt(a, b, 0)), pt(0, 1, 0)]);
    // mowing stripes on the meadow only
    const stripes = [];
    for (let b0 = 0.05; b0 < 0.95; b0 += 0.2) {
      const b1 = Math.min(b0 + 0.1, 0.97);
      stripes.push({ pts: P([pt(0.03, b0, 0), pt(SPLIT - 0.04, b0, 0), pt(SPLIT - 0.04, b1, 0), pt(0.03, b1, 0)]) });
    }
    // dozer geometry
    const CA = 0.58, CB = 0.5, L = 0.26, WD = 0.17;
    const treads = [CB - WD / 2, CB + WD / 2 - 0.045].map(b => ({
      pts: P([pt(SPLIT + 0.02, b, 0), pt(CA + 0.02, b, 0), pt(CA + 0.02, b + 0.045, 0), pt(SPLIT + 0.02, b + 0.045, 0)]),
    }));

    // props
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
    const stump = (gx, gy) => [
      E(gx, gy, 14, 6, '#5c3a1c', 0.5),
      PG(P([[gx - 9, gy - 2], [gx - 9, gy - 14], [gx, gy - 9], [gx, gy + 3]]), '#6b4522'),
      PG(P([[gx, gy + 3], [gx, gy - 9], [gx + 9, gy - 14], [gx + 9, gy - 2]]), '#8a5a2f'),
      E(gx, gy - 14, 9, 5.2, '#c9a97a'),
      E(gx, gy - 14, 5, 2.9, '#b98553'),
      E(gx, gy - 14, 2, 1.2, '#c9a97a'),
    ];
    const heap = (gx, gy, k, cols) => [
      E(gx, gy + 2, 30 * k, 12 * k, '#5c3a1c', 0.35),
      E(gx, gy - 6 * k, 28 * k, 14 * k, cols[2]),
      E(gx + 4 * k, gy - 9 * k, 22 * k, 11 * k, cols[1]),
      E(gx + 8 * k, gy - 13 * k, 11 * k, 5 * k, cols[0]),
    ];
    const clod = (gx, gy, k) => [E(gx, gy, 5 * k, 3 * k, '#6d4527'), E(gx + 1.5 * k, gy - 1 * k, 3 * k, 1.6 * k, '#8a5a33')];
    const puddle = (gx, gy) => [
      E(gx, gy, 40, 22, '#6d4527', 0.55),
      E(gx + 2, gy - 1, 24, 12, '#2f4f66'),
      E(gx + 6, gy - 3, 14, 6, '#3a5f7a'),
      E(gx + 10, gy - 5, 5, 1.6, '#c9e8ee', 0.6),
    ];

    const items = [];
    const at = (a, b, fn, ...rest) => ({ d: a + b, shapes: fn(px(a, b), py(a, b), ...rest) });
    const onMeadow = (a, b) => a < SPLIT - 0.06 && !(a < 0.34 && b < 0.34) && !(a > 0.26 && b > 0.56 && b < 0.9);
    for (let i = 0; i < 40; i++) {
      const a = 0.05 + rnd() * 0.9, b = 0.07 + rnd() * 0.86, k = 0.7 + rnd() * 0.6;
      if (onMeadow(a, b)) items.push({ d: a + b, shapes: clump(px(a, b), py(a, b), k) });
    }
    for (let i = 0; i < 14; i++) {
      const a = SPLIT + 0.03 + rnd() * 0.5, b = 0.06 + rnd() * 0.88;
      if (Math.abs(b - CB) > WD / 2 + 0.06 || a > CA + L) items.push({ d: a + b, shapes: clod(px(a, b), py(a, b), 0.7 + rnd()) });
    }
    items.push(at(0.18, 0.18, tree, 1.15));
    items.push(at(0.12, 0.6, bush, 1));
    items.push(at(0.34, 0.74, puddle));
    items.push(at(0.9, 0.1, stump));
    items.push(at(0.9, 0.86, heap, 1, ['#7cc945', '#4b8f26', '#6d4527']));
    items.push(at(0.7, 0.9, heap, 0.8, ['#b98553', '#8a5a33', '#6d4527']));
    items.push(at(0.84, 0.72, heap, 0.6, ['#b98553', '#8a5a33', '#6d4527']));
    items.sort((p, q) => p.d - q.d);
    const scene = items.flatMap(it => it.shapes);

    // --- bulldozer: iso boxes, rendered via createElement so its idle animation survives re-renders
    const h = React.createElement;
    const box = (a0, b0, a1, b1, h0, h1, [top, right, left]) => [
      h('polygon', { key: `${a0}${b0}${h0}l`, points: P([pt(a0, b1, h1), pt(a1, b1, h1), pt(a1, b1, h0), pt(a0, b1, h0)]), fill: left }),
      h('polygon', { key: `${a0}${b0}${h0}r`, points: P([pt(a1, b0, h1), pt(a1, b1, h1), pt(a1, b1, h0), pt(a1, b0, h0)]), fill: right }),
      h('polygon', { key: `${a0}${b0}${h0}t`, points: P([pt(a0, b0, h1), pt(a1, b0, h1), pt(a1, b1, h1), pt(a0, b1, h1)]), fill: top }),
    ];
    const YEL = ['#f6c445', '#dc9a1f', '#a86b12'], TRK = ['#4a4e5b', '#2b2e3a', '#232634'], STL = ['#b0b6bd', '#9aa0a7', '#7c8189'], GLS = ['#f6c445', '#3a5f7a', '#2f4f66'];
    const a0 = CA - L / 2, a1 = CA + L / 2, b0 = CB - WD / 2, b1 = CB + WD / 2;
    const track = (bb) => [
      ...box(a0, bb, a1 - 0.02, bb + 0.045, 0, 20, TRK),
      ...box(a0 + 0.01, bb + 0.008, a1 - 0.03, bb + 0.037, 20, 23, ['#5d6170', '#3f424d', '#2b2e3a']),
    ];
    const dozer = h('g', { style: { animation: 'rumble .5s steps(1) infinite' } },
      h('ellipse', { cx: r1(px(CA, CB)), cy: r1(py(CA, CB) + 4), rx: 92, ry: 40, fill: '#3f2a18', opacity: 0.35 }),
      ...track(b0),
      ...box(a0 + 0.02, b0 + 0.035, a1 - 0.05, b1 - 0.035, 14, 44, YEL),
      ...box(a0 + 0.03, b0 + 0.045, a0 + 0.12, b1 - 0.045, 44, 78, GLS),
      ...box(a0 + 0.02, b0 + 0.035, a0 + 0.13, b1 - 0.035, 78, 85, YEL),
      ...box(a0 + 0.15, b0 + 0.05, a0 + 0.165, b0 + 0.065, 44, 66, ['#5d6170', '#3f424d', '#2b2e3a']),
      ...track(b1 - 0.045),
      ...box(a1 - 0.05, b0 + 0.01, a1 + 0.04, b0 + 0.03, 18, 26, ['#dc9a1f', '#a86b12', '#7d5027']),
      ...box(a1 - 0.05, b1 - 0.03, a1 + 0.04, b1 - 0.01, 18, 26, ['#dc9a1f', '#a86b12', '#7d5027']),
      h('g', { style: { animation: 'blade 1.6s ease-in-out infinite' } },
        ...box(a1 + 0.035, b0 - 0.02, a1 + 0.06, b1 + 0.02, 2, 40, STL),
        ...box(a1 + 0.06, b0 - 0.02, a1 + 0.066, b1 + 0.02, 2, 12, ['#7c8189', '#5d6170', '#3f424d']),
      ),
      h('ellipse', { cx: r1(px(a1 + 0.12, CB)), cy: r1(py(a1 + 0.12, CB) - 8), rx: 44, ry: 22, fill: '#6d4527' }),
      h('ellipse', { cx: r1(px(a1 + 0.13, CB) + 4), cy: r1(py(a1 + 0.13, CB) - 12), rx: 34, ry: 16, fill: '#8a5a33' }),
      h('ellipse', { cx: r1(px(a1 + 0.14, CB) + 8), cy: r1(py(a1 + 0.14, CB) - 17), rx: 16, ry: 7, fill: '#b98553' }),
    );
    const dust = h('g', null,
      ...[0, 0.75, 1.5].map((delay, i) => h('ellipse', {
        key: i, cx: r1(px(a0 - 0.02 + i * 0.03, b1 + 0.03)), cy: r1(py(a0 - 0.02 + i * 0.03, b1 + 0.03) - 8),
        rx: 14, ry: 9, fill: '#c9a97a', style: { transformOrigin: `${r1(px(a0, b1 + 0.03))}px ${r1(py(a0, b1 + 0.03))}px`, animation: `puff 2.2s ease-out ${delay}s infinite` },
      })),
      ...[0.4, 1.3].map((delay, i) => h('ellipse', {
        key: 'b' + i, cx: r1(px(a1 + 0.1, b1 + 0.02) + i * 10), cy: r1(py(a1 + 0.1, b1 + 0.02) - 20),
        rx: 12, ry: 8, fill: '#c9a97a', style: { transformOrigin: `${r1(px(a1 + 0.1, b1))}px ${r1(py(a1 + 0.1, b1))}px`, animation: `puff 2.2s ease-out ${delay}s infinite` },
      })),
    );
    return { doc: !this.props.tile, wrapPad: this.props.tile ? '0' : '48px 24px 80px', fringe, meadow, stripes, treads, scene, dozer, dust };
  }
}
/* ── template ── */
function tpl(v) { return [h("div", {"style": S(J(v,["max-width:920px;margin:0 auto;padding:", " wrapPad ", ""])), "data-tile-wrap": "1"}, "\n  ", (R(v," doc ") ? ["\n  ", h("h1", {"style": S("font-weight:500;font-size:26px;letter-spacing:-.01em;margin:0 0 6px")}, "Isometric plot — grading"), "\n  ", h("p", {"style": S("color:#9a9aa5;margin:0 0 28px")}, "Stage 2 of the ladder — the buyer owns the plot and is levelling it. Same base as the plot and villa; a bulldozer has cleared the front-right half down to flat earth, the back-left half is still meadow. Hand this whole file to a coding agent. Previous stage: ", h("a", {"href": "Isometric Plot - reference for Claude Code.html"}, "the empty plot"), "."), "\n\n  "] : null), "\n  ", h("svg", {"viewBox": "0 -60 820 700", "style": S("width:100%;height:auto;display:block")}, "\n    ", h("polygon", {"points": "410,100 794.5,322 410,544 25.5,322", "fill": "#232739"}), "\n    ", h("polygon", {"points": "794.5,322 410,544 410,595 794.5,373", "fill": "#1b1e2c"}), "\n    ", h("polygon", {"points": "410,544 25.5,322 25.5,373 410,595", "fill": "#12141d"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,516 721.8,336", "fill": "#8a5a33"}), "\n    ", h("polygon", {"points": "410,444 98.2,264 98.2,336 410,516", "fill": "#6d4527"}), "\n    ", h("polygon", {"points": "721.8,264 410,444 410,458 721.8,278", "fill": "#3f2a18", "opacity": "0.35"}), "\n    ", "\n    ", h("polygon", {"points": "721.8,250 410,430 410,444 721.8,264", "fill": "#7a4d2b"}), "\n    ", h("polygon", {"points": "410,430 229.2,325.6 229.2,339.6 410,444", "fill": "#5c3a1c"}), "\n    ", h("polygon", {"points": "229.2,325.6 98.2,250 98.2,264 229.2,339.6", "fill": "#3f7a20"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," fringe ")).map((it, i) => (v => [h("polygon", {"points": R(v," f.pts "), "fill": R(v," f.fill ")})])({...v, "f": it, $index: i}))), "\n    ", "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "#9a6a3f"}), "\n    ", h("polygon", {"points": "410,70 721.8,250 410,430 98.2,250", "fill": "none", "stroke": "#6d4527", "stroke-width": "8"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," treads ")).map((it, i) => (v => [h("polygon", {"points": R(v," t.pts "), "fill": "#7a4d2b", "opacity": "0.55"})])({...v, "t": it, $index: i}))), "\n    ", h("polygon", {"points": R(v," meadow "), "fill": "#6cba36"}), "\n    ", h("polygon", {"points": R(v," meadow "), "fill": "none", "stroke": "#3f7a20", "stroke-width": "8"}), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," stripes ")).map((it, i) => (v => [h("polygon", {"points": R(v," s.pts "), "fill": "#74c43c", "opacity": "0.4"})])({...v, "s": it, $index: i}))), "\n    ", ...((L => Array.isArray(L) ? L : [])(R(v," scene ")).map((it, i) => (v => ["\n      ", (R(v," t.isPoly ") ? [h("polygon", {"points": R(v," t.pts "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n      ", (R(v," t.isEllipse ") ? [h("ellipse", {"cx": R(v," t.cx "), "cy": R(v," t.cy "), "rx": R(v," t.rx "), "ry": R(v," t.ry "), "fill": R(v," t.fill "), "opacity": R(v," t.op ")})] : null), "\n    "])({...v, "t": it, $index: i}))), ...T(v,["\n    ", " dozer ", "\n    ", " dust ", "\n  "])), "\n  ", (R(v," doc ") ? ["\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "What this asset is"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "The plot after purchase, mid-grading. Base plinth and soil skirt are byte-identical to the plot and villa. The grass top is split at ", h("code", {}, "a = 0.42"), ": everything at higher ", h("code", {}, "a"), " (front-right) is flat earth ", h("code", {}, "#9a6a3f"), "; the meadow keeps its clumps, one tree and a bush. The split is a jittered polyline, stroked ", h("code", {}, "#3f7a20"), ", so it reads as a cut sod edge."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "What reads as \"being levelled\": twin tread marks running from the sod edge to the machine, sod and topsoil heaps at the front corner, a fresh stump where the second tree stood, a drying puddle where the pond was, and the dozer itself with an earth mound against the blade."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "The board is gone — it has been bought. No fence, no structures yet. Next stage: ", h("code", {}, "Isometric Construction"), " (foundation → walls → villa)."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "The bulldozer"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Built entirely from axis-aligned iso boxes. A box spans tile coords ", h("code", {}, "a0..a1 × b0..b1"), " and heights ", h("code", {}, "h0..h1"), " (px). Its three visible faces: top at ", h("code", {}, "h1"), "; the ", h("code", {}, "+a"), " face (lit); the ", h("code", {}, "+b"), " face (shaded). Corner ", h("code", {}, "(a,b,h) → (410 + (a−b)·311.8, 70 + (a+b)·180 − h)"), "."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Parts, back-to-front: far track → hull → cab (glass box, yellow roof) → exhaust → near track → push arms → blade → earth mound. Machine yellow ", h("code", {}, "#f6c445 / #dc9a1f / #a86b12"), " (the gold-coin ramp), tracks ", h("code", {}, "#3f424d / #2b2e3a / #232634"), ", glass ", h("code", {}, "#3a5f7a / #2f4f66"), ", blade steel ", h("code", {}, "#b0b6bd / #9aa0a7 / #7c8189"), "."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Motion: the hull group idles on a 0.5s ", h("code", {}, "rumble"), " (sub-pixel translate), the blade group on a 1.6s ", h("code", {}, "blade"), " bob, and three dust ellipses cycle a 2.2s ", h("code", {}, "puff"), " with staggered delays. Transforms only — geometry is never rotated or skewed."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Paint order"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Plinth → soil skirt → edge bands + fringe → full earth top + earth boundary → tread marks → meadow polygon + sod stroke → mowing stripes → scattered props sorted by ", h("code", {}, "a + b"), " → dozer group → dust."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Strokes only for parcel boundary and sod edge. Flat polygons and ellipses; no gradients."), "\n  "), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Prompt that works"), "\n  ", h("pre", {"style": S("background:#1e2130;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:12px;color:#c9c6da;margin:0;white-space:pre-wrap")}, "Draw an isometric plot being levelled by a bulldozer as inline SVG.\n\nProjection: fixed 2:1 isometric, same as the plot. Tile coords a,b in\n[0,1] map to x = 410 + (a-b)*311.8, y = 70 + (a+b)*180 - h. Never\nrotate or skew geometry.\n\nBase identical to the plot parcel. Grass top: earth #9a6a3f under\neverything, then a meadow polygon covering a < 0.42 in #6cba36 with a\njittered edge stroked #3f7a20 8px. Two tread stripes #7a4d2b @.55 run\nalong the a-axis from the sod edge to the machine.\n\nBulldozer at a=0.58, b=0.5 facing +a, made only of iso boxes\n(top, +a lit face, +b shaded face): two tracks, hull, cab with glass,\nexhaust, push arms, steel blade, earth mound at the blade. Yellow\n#f6c445/#dc9a1f/#a86b12, tracks #3f424d/#2b2e3a/#232634.\n\nProps: one tree + bush + grass clumps on the meadow, a stump and sod\nheaps on the earth, a drying puddle. Three dust ellipses on a 2.2s\nfade-and-rise loop; hull on a 0.5s sub-pixel rumble.\n\nPaint back-to-front by a+b. No gradients. No strokes for shading."), "\n\n  ", h("h2", {"style": S("font-weight:500;font-size:15px;margin:32px 0 8px")}, "Reuse"), "\n  ", h("ul", {"style": S("padding-left:20px;margin:0")}, "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "Copy the ", h("code", {}, "<svg>"), " block plus the three ", h("code", {}, "@keyframes"), ". For a static board tile drop the animation styles — the silhouette alone reads."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "On a grid tile: ", h("code", {}, "<g transform=\"translate(TX,TY) scale(S) translate(-410,-250)\">"), " — same wrapper as the plot and villa."), "\n    ", h("li", {"style": S("color:#c9c6da;margin-bottom:5px")}, "To animate progress, move the sod edge ", h("code", {}, "a"), " from 0.42 toward 0 and the dozer with it; at ", h("code", {}, "a = 0"), " the whole top is earth and the construction stage begins."), "\n  ")] : null))]; }
export const HELMET = [{"tag": "style", "attrs": {}, "text": "\n    body { margin:0; background:transparent; color:#e9e9ed; font:14px/1.5 Inter, system-ui, sans-serif; }\n    a { color:#b5abfc; } a:hover { color:#d2cefd; }\n    @keyframes puff { 0% { opacity:0; transform:translate(0,0) scale(.5) } 20% { opacity:.55 } 100% { opacity:0; transform:translate(-14px,-30px) scale(1.6) } }\n    @keyframes rumble { 0%,100% { transform:translate(0,0) } 25% { transform:translate(0,-.8px) } 50% { transform:translate(.4px,0) } 75% { transform:translate(0,.6px) } }\n    @keyframes blade { 0%,100% { transform:translate(0,0) } 50% { transform:translate(0,-2px) } }\n  "}];
export default defineDC("part-stage-grading", typeof Component !== "undefined" ? Component : null, tpl, {}, HELMET);
