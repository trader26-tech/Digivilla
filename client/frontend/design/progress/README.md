# Estate Levels — the 45-level estate ladder (Progress screen)

Everything needed to recreate this screen exactly. Read this file, then `Villa Ladder.dc.html` (the ladder itself).

## Files
- `Estate Levels (standalone).html` — RUN THIS FIRST. Bundled, works offline. It is the visual truth; open it beside the code.
- `Estate Levels.dc.html` — the outer screen: HUD, the SIP hero, and the sheet that hosts the ladder.
- `Villa Ladder.dc.html` — the ladder. Template = markup between <x-dc>…</x-dc> (all inline styles); logic = `class Component` at the end.
- `Villa Tile.dc.html`, `Isometric Plot/Grading/Foundation/Steel Frame …dc.html` — the five stage drawings, pure SVG polygons, viewBox "0 -60 820 700".
- `styles.css` — design tokens. Copy the :root block.

## The model (all numbers live in Villa Ladder renderVals)
- 9 houses × 5 stages = 45 levels. Each stage = ₹1,00,000. Stage names: The Plot · Levelled Ground · Foundation · Steel Frame · The Villa.
- House h occupies tile ORDER[h-1] of a 3×3 board. ORDER = centre, front corner, front-left, front-right, left corner, right corner, back-left, back-right, back corner
  = [[1,1],[2,2],[1,2],[2,1],[0,2],[2,0],[0,1],[1,0],[0,0]] as [col,row].
- Board geometry (Home's proportions): cell half-width 54px, half-height 31.2px, origin x=201 (phone centre).
  cell centre = (201 + (col−row)·54, y0 + (col+row)·31.2). Paint by (col+row) ascending; the current house's art is HTML between two SVG layers (back cells/villas, front cells/villas).
- Stage art is 142px wide; its grass centre is at (71, 53.7) inside the art, so art.left = cx−71, art.top = cy−53.7.
- Each completed villa costs ₹5L and adds ₹1,500/month (SWP). Income label on villa h = ₹1,500 × h.

## Card anatomy (one 754px section per level, lowest level at the bottom)
1. "^ Level n · Name" caption (levels above), or "Final level".
2. Board (330px tall; 214px on villa cards) with the "House h of 9 · building/complete" kicker centred above.
   Chip at the board's centre: green tick "COMPLETED · PAID ₹nL" when paid; padlock "Unlocks at ₹n" when locked. Nothing on the current level.
   Locked levels: the whole board is grayscale(1) brightness(.75).
3. Title (32px, weight 800, glow), then the LEVEL banner: gold numeral coin · LEVEL n · gold ₹ milestone. 300px wide, centred.
4. Villa cards only — the credit panel (300px, centred):
   • locked: grayscale; ₹ coin with padlock; "+₹X / month · FROM VILLA h"; bar = total invested / (5·h·L) with "₹4L in" left and goal right; "₹nL to go".
   • complete: gold panel, unlockIn spring + goldPulse loop; amount counts up 0→₹X over 1.4s (cubic ease-out); coin spins (coinSpin) with two ringOut pulses; six small coins fountain (coinBurst, staggered .38s); sheen sweep; "VILLA h PAYS YOU · credited on the 5th".
5. "FUND UNLOCKS": five tiles (Arbitrage 36% · Gold 16% · Large 16% · Mid 16% · Small 16% of the milestone) — icon, name, amount, a 22×2px colour mark. No percentages shown.

## Rail (left, x=10, 8px wide, scrolls with the list)
- One continuous track; fill from ₹0 up to worth. A glowing dot at worth, and a text-only "₹4L" pill floating 14px above the dot, anchored to the rail's left edge.
- Checkpoints only at villa completions (₹5L, ₹10L … ₹45L): a flag node when ahead; a green ticked node with glow and tinted "Villa h · ₹nL" tag once reached. "₹0" at the bottom. No per-level ticks.

## Controls
- HUD right: gold "Earn ₹X/mo ↑" button (goldPulse). X = ₹1,500 × the house of whatever level is on screen (a villa level counts toward the next house). Tap → smooth-scrolls to that villa card; label then advances. Reads "Estate complete" at villa 9.
- Bottom-right round arrow (40px): appears only when the level on screen ≠ current; arrow points toward the current level (down if it's below, up if above); tap smooth-scrolls there.
- On open (and on reset), scroll to the current level's section (retry on rAF and +150ms; the list is ~34,000px tall).
- viewLevel = clamp(1..45, 45 − round((scrollTop − 100) / 754)); sections are 754px, list starts after a 100px spacer.

## Rules
- Inter only. No pure black/white — tokens from :root. Accent (#9184d9) for lines/glows; gold (#f6c445 family) ONLY for money.
- Indian grouping: ₹1,00,000. Say "withdrawals"/"pays you", never "guaranteed".
- Keyframes used: bob, mapPulse, unlockIn, coinSpin, ringOut, sheen, coinBurst, goldPulse, nudge (all in the <helmet><style>).
