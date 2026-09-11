# Estate Levels — the estate ladder (Progress screen)

Everything needed to recreate this screen exactly. Read this, open the standalone file beside the code, then `Villa Ladder.dc.html`.

## Files
- `Estate Levels (standalone).html` — RUN THIS FIRST. Bundled, offline. It is the visual truth.
- `Estate Levels.dc.html` — the outer screen: HUD, SIP hero, the sheet hosting the ladder.
- `Villa Ladder.dc.html` — the ladder. Template = markup between <x-dc>…</x-dc> (inline styles only); logic = `class Component` at the end.
- `Villa Tile.dc.html` + `Isometric Plot/Grading/Foundation/Steel Frame …dc.html` — the five stage drawings. Pure SVG polygons, viewBox "0 -60 820 700".
- `styles.css` — design tokens. Copy the :root block.

## Model (all in Villa Ladder renderVals)
- Level 0 (start) + 45 levels: 9 houses × 5 stages, each stage ₹1,00,000 (L). Stage names: The Plot · Levelled Ground · Foundation · Steel Frame · The Villa.
- current = min(45, floor(worth / L) + 1). Level k: threshold k·L, start (k−1)·L. isDone k<current, isCurrent k===current, isLocked k>current.
- House h fills tile ORDER[h−1] of a 3×3 board. ORDER = [[1,1],[2,2],[1,2],[2,1],[0,2],[2,0],[0,1],[1,0],[0,0]] as [col,row] (centre, front corner, front-left, front-right, left, right, back-left, back-right, back).
- Board: half-width 54, half-height 31.2, origin x=201. cell centre = (201 + (col−row)·54, y0 + (col+row)·31.2), y0 = 120 (56 on villa cards). Paint by (col+row) ascending: back cells/villas SVG → current house art (HTML, 142px wide, grass centre at (71,53.7)) → front cells/villas SVG.
- Each villa = ₹5L, pays ₹1,500/month (SWP). Villa h shows ₹1,500·h.
- Funds: Arbitrage 36% · Gold 16% · Large 16% · Mid 16% · Small 16% of the level's threshold.

## Cards (one <section> per level, 754px tall, lowest at the bottom; list starts after a 100px spacer)
Level 0 "Your Land": bare dashed board, centre tile is a plain green ground block (dimmer at ₹0, full green at ₹1L, via a dark gradient overlay at opacity 1−p); a 76px progress ring over it showing what's in (₹10k…); replaced by the green "COMPLETED" chip once worth ≥ ₹1L. Banner "0 · START · ₹0". Then "YOUR MIX": five fund tiles with PERCENTAGES only.
Levels 1–45:
1. Caption "^ Level n · Name" (or "Final level").
2. Board + kicker "House h of 9 · building/complete". Chip at the board centre: green tick "COMPLETED" on done levels; padlock "Unlocks at ₹n" on locked. Nothing on the current level. Locked boards: grayscale(1) brightness(.75).
   Current level art: the PREVIOUS stage at full opacity underneath; the target stage as a 22% grey ghost; the target stage rising via clip-path inset((1−p)·100% 0 0 0), p = (worth−start)/L.
3. Title (32px/800, glow) + LEVEL banner (300px): gold numeral coin · LEVEL n · gold ₹ threshold. The banner carries data-banner="n" — the rail aligns to it.
4. Current level only: progress strip "₹4L in" … "₹1L to go" with a 4px accent bar.
5. Villa cards: the credit panel (300px). Locked = grayscale, ₹ coin with padlock, "+₹X / month · FROM VILLA h", bar = worth / (5·h·L) with "₹nL in" left and goal right, "₹nL to go". Complete = gold panel: unlockIn spring + goldPulse loop, amount counts 0→X over 1.4s, coinSpin + two ringOut pulses, six coinBurst coins, sheen sweep, "VILLA h PAYS YOU · 1st credit 5 Oct".
6. "FUND UNLOCKS": five tiles — icon, name, ₹ amount (current level: amount actually in + "of ₹target"), 22×2px colour mark.

## Rail (left:10px, width 8px, scrolls with the list)
- Continuous track; fill from the ₹0 node up to worth; glowing 14px dot at worth; text-only "₹4L" pill floating 14px above the dot, anchored to the rail's left edge.
- A checkpoint at EVERY level, vertically aligned to that level's banner (measured from [data-banner] after layout; un-scale by rail.rect.height / rail.style.height). ₹1L…: 10px ring + ₹ label (accent when reached). Villas (₹5L, ₹10L…): 20px node — grey flag ahead, green ticked node + tinted "Villa h · ₹nL" tag when reached. ₹0 node on the START banner.
- Fill/dot position = linear interpolation between the two neighbouring checkpoints.

## Controls
- HUD right: gold "Earn ₹X/mo ↑" (goldPulse). X = ₹1,500 × house of the level on screen (a villa level counts toward the next house). Tap → smooth-scroll to that villa card; label then advances; "Estate complete" at villa 9.
- Bottom-right 40px round arrow: appears when the level on screen ≠ current; points toward the current level (down if below, up if above); tap smooth-scrolls there.
- viewLevel = clamp(0..45, 45 − round((scrollTop − 100)/754)). On open: scroll to section[data-current], retry on rAF and +150ms.

## Rules
- Inter only. Tokens from :root; no pure black/white. Accent #9184d9 for lines/glows; gold (#f6c445 family) ONLY for money.
- Indian grouping ₹1,00,000; lakh short form ₹4L / ₹10k. "Pays you"/"withdrawals", never "guaranteed".
- Keyframes: bob, mapPulse, unlockIn, coinSpin, ringOut, sheen, coinBurst, goldPulse, nudge (in <helmet><style>).
