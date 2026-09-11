# Sanjeev's City — Home screen, inch by inch

Give this whole folder to the coding agent. The instruction to the agent is one line:
**"Open `Sanjeevs City (standalone).html` in a browser as the visual truth, then replicate `sanjeevs-city-template.html` — the Home screen (#scr-home) and the estate model — exactly. Do not redesign."**

## Files
- `Sanjeevs City (standalone).html` — RUNNABLE, offline, fonts inlined. Open with `?worth=2675000` etc. This is what it must look like.
- `sanjeevs-city-template.html` — the full plain-HTML app (Home · Progress ladder · Settings). No framework. Everything below is quoted from it.
- `home-only/home.css.txt` — the complete <style> block (tokens + every Home rule).
- `home-only/home.markup.html` — the Home screen markup: header, estate title, board <svg> with all tile <defs>, coin, portfolio block, disclaimer.
- `home-only/estate-model.js` — `applyEstate(worth)`: the one function that turns ₹ into the board + header + portfolio.
- `sip/` — the Progress ladder and stage drawings (iframe'd by the Progress tab).
- `styles.css` — design tokens (:root).

## The rule that drives everything
ONE number, `ESTATE_WORTH` (total ₹ invested). From it:
- `villas  = floor(worth / 5,00,000)` — finished houses (max 9)
- `rem     = worth − villas × 5,00,000` — money in the house being built
- `stage   = floor(rem / 1,00,000)` → 0 ground · 1 The Plot · 2 Levelled Ground · 3 Foundation · 4 Steel Frame
- `building = villas < 9 && rem > 0`
Examples: ₹10,000 → 1 green ground tile. ₹25,00,000 → 5 villas, 4 open tiles. ₹26,75,000 → 5 villas + Plot 06 at "The Plot" (₹1,75,000 of ₹5,00,000). ₹45,00,000 → 9 villas.
Header: Withdrawals = ₹1,500 × villas "/mo" (heading 24px gold; only the "/mo" span is small — rule is `.flow-fig span:last-child`), sub "N villas · SWP on the 1st". Invested = ₹worth, sub "1 building · SIP on the 5th". Portfolio: Invested ₹worth · value = worth × (1 + 0.0055 × round(worth/25,000)) · returns %.
The Progress ladder reads the same number (`ladderWorth()` → ESTATE_WORTH). Never let the two drift.

## Board geometry (the 9 squares)
- SVG `viewBox="-175 15 590 375"`, drawn at 100% of the phone width inside `.board`.
- Tile symbols in <defs>: `#tLocked` (dashed open tile) · `#tGround` (plain green block) · `#tLand` (The Plot) · `#tGrade` · `#tFound` · `#tSteel` · `#tVilla`. Each symbol is drawn on a 240-wide diamond whose top-face centre is (120, 80).
- Cell (col,row) is placed with `<use href="#…" x="(col−row)×93.6" y="(col+row)×54">`.
- House h (1-based) occupies `ORDER[h−1]`, ORDER = [[1,1],[2,2],[1,2],[2,1],[0,2],[2,0],[0,1],[1,0],[0,0]] = centre, front corner, front-left, front-right, left corner, right corner, back-left, back-right, back corner.
- PAINT ORDER IS NOT OPTIONAL: emit cells sorted by (col+row) ascending, ties by col. SVG has no z-buffer; a back tile emitted late paints over the house in front of it.
- Each cell: `<g class="cell [building]" data-name data-note data-state="villa|build|locked" data-col data-row [data-paid]><use …></use></g>`. `data-paid` = ₹25,000 instalments in that house (20 = complete).
- The rent coin (`#rentCoin`, coinBob 2.4s) floats over the first villa; hidden when villas = 0.

## Level 0 → Level 1 (the first thing a new user sees)
- Stage 0 is `#tGround` on Home and `sip/Isometric Ground - reference for Claude Code.dc.html` on the ladder — the SAME polygons, generated once. A quiet meadow: soft grass patches, tufts, four wildflower clusters, a young tree at the back corner, two butterflies. No pegs, no flag, no bare soil, no FOR SALE board anywhere.
- Level 1 (The Plot) keeps the base and grows it: mowing stripes, all the tufts, the tree at full size, pond with reeds, bushes, stones. The Plot has no sign.
- On the ladder the plot rises out of the ground (clip-path from bottom, driven by ₹ in / ₹1,00,000), so land → plot reads as one scene.
- On Home a started-but-under-₹1L house (₹10,000) shows `#tGround` with the breathing green glow (`.cell.building use[href="#tGround"]` → groundGlow 2.8s). It must survive the SIP preload: stage-0 cells are not queued, and sipMirror never demotes a started build to locked.

## The green halo (yes, it matters)
- `.board` has a radial glow behind the estate: `background: radial-gradient(circle at 50% 58%, rgba(108,186,54,.16) 0%, transparent 62%)` — see `.board` in home.css.txt for the exact rule and size.
- A building tile gets `.cell.building { filter: drop-shadow(0 0 10px rgba(108,186,54,.55)) }` and the header title has the soft top glow (`.estate` / `.flows` rules). Copy the rules verbatim; do not approximate.

## Layout (top → bottom, 402 × 874 phone, all from home.css.txt)
1. `.flows` header, padding 54px 26px 0: two columns split by `.flow-div`. Left = WITHDRAWALS (gold arrow chip, 24px heading in #f3dfa8, "/mo" 11px grey, sub-line). Right = INVESTED (violet arrow chip, 24px heading in accent-200, sub-line). Labels 10px, .14em tracking, uppercase.
2. `.estate` title block: kicker YOUR ESTATE (10px, .16em) + name 30px/500.
3. `.board` — the SVG, full width, the dominant element (~360px tall incl. glow).
4. `.port` block, centred: PORTFOLIO VALUE kicker · value 44px/500 · "Invested ₹… • +x.x% returns" (returns in the green ramp) · `.port-bar` 5 segments 36/16/16/16/16 (#8aa89b, #f6c445, #4a9d47, #5cb85c, #8fd48a) · `.port-funds` five columns: percentage (13px/500) over fund name (9px, in the segment colour).
5. `.fine` — "What do Villa and Plot mean? ›" link (opens the disclaimer sheet), padding-bottom 96px so it clears the bar.
6. `.tabs` — floating pill (also over the Progress ladder; the ladder's up/down arrow is raised 72px above it via `bottom-inset`), bottom 22px, centred: Settings (gear) · Home (house + label, active bg #2b2741, accent text) · Progress (flag). 46px tall items, 23px radius, bar bg rgba(30,33,48,.94) with 1px neutral-700 ring and blur.

## Rules
- Inter only; weights 400/500 (800 only on the ladder banners). Tokens from :root — no raw black/white.
- Indian grouping (₹26,75,000); short form ₹4L / ₹10k where the ladder uses it.
- Gold (#f6c445 family) is ONLY for money the user receives; accent (#9184d9) for structure.
- Copy: "withdrawals", "pays you". Never "guaranteed", "rent earned", "collect".

## Settings tab (`#scr-settings`) — rebuilt
Source: `settings-only/settings.markup.html` + `settings.css.txt` + `settings.js` (all excerpted from the template; the template is the truth).

Order, top → bottom, inside `.st` (scrolling column, 22px side padding, 110px bottom pad for the floating tab bar):
1. `.id` — identity, NO box. 54px circular avatar (radial accent gradient, initial "R"), tap to upload a photo (`<label class="id-av">` wraps a hidden file input; result stored in localStorage `sc.avatar` and mirrored to every `.avImg`). Name 20px heading, phone under it, quiet "Log off" pill on the right (turns red on hover).
2. `.st-pres` — 4-min presentation poster (`<a target=_blank>` to the artifact). Text bottom-left, play button bottom-right with pulsing ring, villa `<use href="#tVilla">` top-right (right:10px; top:-14px; width:196px). Poster inherits text colour, not link colour.
3. `.st-card.acc` — one "Account" group, three rows (`.ar`): Transactions (`data-open="ap-tx"`), Personal details (`data-open="ap-me"`), Call your advisor (`<a href="tel:+918925188870">` — dials directly, no panel). Row = 38px rounded icon tile, title 14px, subline 11.5px, chevron.
4. `.up` — Update to latest: accent-glow card, icon tile with pulsing gold dot, version line, "Update" button → 1.4s later `.done` state ("Up to date").
5. `.st-fine` — one-line disclaimer.

Panels (`.ap`) are full-screen overlays inside `.phone` (position:absolute; inset:0; z-index:30), slide up with `apIn`, header = round "‹" back button + title. `goTab()` hides all panels when the tab changes.
- **Transactions** `#ap-tx`: search (`#txQ`), filter pills `.fchip` (All / Lumpsum / Purchase / Payouts — NOT `.chip`, that class is the Home HUD coin), summary strip `.tf` (Put in left/accent, Paid out right/gold, thin bar), count + sort dropdown (`.sortm`: Newest / Oldest / Largest / By fund). Rows `.tx2`: coloured sleeve tag (ARB/GOLD/MID/SMALL/LARGE — same hex as the Home allocation bar), fund name, type, one amount. No units/NAV. Data in `var TX` (real orders from the AssetPlus report).
- **Personal details** `#ap-me`: avatar + client code, 2-col tile grid of inputs. Phone/email/address editable; PAN/DOB/bank `readonly` with lock mark. "Save changes" enables on any edit, writes phone back to the header.

Rules: no SIP wording anywhere on this tab (users invest lumpsum); "Payouts", never "rent earned"; every class here is namespaced (`ar`, `ap`, `tf`, `tx2`, `fchip`, `sortm`) — don't reuse Home's `.flow*` or `.chip`.
