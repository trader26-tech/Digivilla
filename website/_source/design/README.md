# Handoff: TheDigiCiti website

## Overview
A marketing site for **TheDigiCiti** (DigiVilla): an investment product sold to NRIs as "a villa in India that pays you rent, built by your SIP". The site is a scroll-driven story in four parts:

1. **Landing** — dusk sky, a villa that splits into five build stages as you scroll, then a big "Explore" call to action.
2. **Mobile showcase** — five phones in a 3-D fan showing the app screens.
3. **Calculator** — FD vs DigiVilla and Flat vs DigiVilla, with isometric bar columns.
4. **Story** (separate page, reached via Explore) — Chapter 1 "The journey" (NRI flight, the ₹1 crore question), Chapter 2 "Reading the map" (a pen draws the return / risk graph step by step), Chapter 3 "Your numbers" (the same calculator).

## About the design files
Everything in this folder is a **design reference written in HTML**. It is a working prototype showing the intended look, copy, timing and behaviour — not production code to ship as-is. The task is to **recreate these screens in the target codebase** (React/Next, Vue, Svelte, plain HTML + GSAP — whatever the project uses; if nothing exists yet, Next.js + Framer Motion or plain HTML + GSAP ScrollTrigger are good fits) with the same visuals, copy and motion.

The `.dc.html` files use a small templating runtime (`support.js`): `{{ name }}` holes are filled from the `renderVals()` method of the `class Component` at the bottom of each file; `<sc-if>` / `<sc-for>` are if / loop; `<dc-import name="x">` mounts the sibling `x.dc.html`; `<helmet>` is the document head. Read the markup as plain HTML with inline styles and the class as the page's JavaScript. All styling is inline — every hex, size and easing you need is in the markup.

## Fidelity
**High fidelity.** Colors, type, spacing, copy and motion are final. Recreate pixel-close.

## Files in this package
| File | What it is |
|---|---|
| `thedigiciti_website.dc.html` | **Main page**: landing + mobile showcase + embedded calculator. Start here. |
| `calculator.dc.html` | Calculator (standalone page and embedded section). Contains all the maths. |
| `story.dc.html` | Story shell: Home button, chapter pills, gold-coin chapter wipe. Mounts the three chapters. |
| `story-1-journey.dc.html` | Chapter 1 — the flight, the ₹1 crore question, FD vs real estate, "So we built a DigiVilla", three profiles. |
| `story-2-map.dc.html` | Chapter 2 — the pen-drawn return / risk graph (8 scroll steps). |
| `story-3-numbers.dc.html` | Chapter 3 — calculator inside the story (older copy of `calculator.dc.html`). |
| `part-stage-plot/-grading/-foundation/-steel.dc.html` | Isometric SVG tiles for build stages 01–04 (stage 05 is `assets/explore/villa.png`). |
| `part-transitions.js` | Page-to-page transition (`tdcVeil`): sky fade and gold-coin veil. Plain JS, reusable as-is. |
| `support.js` | Prototype runtime. **Do not port.** |
| `_ds/` | DigiVilla design-system tokens (`tokens/*.css`) and component bundle. Use the tokens. |
| `assets/` | All images (see Assets). |
| `BRAND.md`, `PROJECT-MAP.md` | Brand rules and the original project map. |

Open `thedigiciti_website.dc.html` from a local static server (files fetch siblings; `file://` will not work).

---

## Design tokens

### Palette
**Dusk (landing)**
- Sky gradient, top → bottom: `#0c0f2c` 0%, `#1d1d4a` 16%, `#2a2862` 28%, `#73467c` 44%, `#b8606a` 54%, `#d9814f` 63%, `#f3bd7c` 74%, `#a8606a` 88%, `#3a2a52` 100%
- Sun: radial `#fff5d6` → `#ffd38a` → transparent; halo `rgba(255,222,170,.8)` → `rgba(240,138,74,.35)`
- Cream text `#E1E0CC`; muted cream `rgba(225,224,204,.7)`; body copy `rgba(222,219,200,.7)`
- Gold (rent / coin) `#f6c445`, light gold `#fbdb81`, warm label `rgba(255,226,170,.9)`
- Page black `#000`

**Night (app, story, calculator)**
- Backgrounds `#0b0c12` (page), `#161826` (card), `#12141d` / `#1a1c28` (chips), `#0b0c12` inset fields
- Borders `#1f2233`, `#22253a`, `#2b2e3a`
- Text `#ececf1` / `#e9e9ed` (primary), `#a3a5b4` (secondary), `#7a7c8c` (tertiary), `#5a5e6c` / `#4d4f5e` (hint)
- Growth green `#8fd65a` (dark `#4f9528`, `#2a5e18`); FD grey column `#6d7184` → `#585c6e`
- Risk red `#e2725b`; purple glow `rgba(127,114,224,.16)`; link `#b5abfc`
- Warm story cream `#fff6ea`, `#ffd9a8`, `#ffd38a`

### Type
- Landing: **Almarai** 300/400/700/800 (Google Fonts) + **Instrument Serif** italic for accents.
- Story / app / calculator: **Inter** 400/500/600; Chapter 2 pen captions: **Caveat** 500/700.
- Landing H1: `clamp(48px, 11.6vw, 250px)`, weight 400, line-height .85, letter-spacing −.07em.
- "Explore": `clamp(64px, min(10.5vw,19vh), 220px)`, gradient text `#fffaf0 → #E1E0CC → #cdb894`.
- Story H2: `clamp(40px, 6vw, 92px)`, weight 500, letter-spacing −.045em, line-height 1.
- Section kickers: 11–13px, letter-spacing .24–.32em, uppercase.
- Body: `clamp(15px, 1.25vw, 19px)`, line-height 1.5.

### Radii, shadows, spacing
- Landing frame radius `clamp(16px, 2vw, 32px)`, inset `clamp(12px, 1.6vw, 24px)` from the viewport.
- Cards 14–24px radius; pills 999px; phone bezel 60px outer / 50px screen.
- Glow shadows: villa `drop-shadow(0 0 28px rgba(255,180,110,.4)) drop-shadow(-30px 40px 50px rgba(20,14,30,.6))`; Explore button `0 0 50px rgba(255,214,150,.6)`.
- Easing: reveals `cubic-bezier(.16,1,.3,1)` 0.9s; camera / big moves `cubic-bezier(.55,0,.25,1)` 0.7s; bars `cubic-bezier(.2,.8,.2,1)` 0.8s.

---

## Screen 1 — Landing (`thedigiciti_website.dc.html`, top)

**Layout.** The whole page is a custom scroll container (`position:fixed; inset:0; overflow-y:auto`, scrollbar hidden). The first block is `280vh` tall with a sticky `100vh` frame inside it, so the landing plays as a scrubbed animation over 1.8 viewports of scroll. Progress `p = clamp(scrollTop / (1.8 × viewportHeight))`, smoothed each frame: `sp += (p − sp) × .12`.

**Inside the frame (rounded, overflow hidden):**
- Sky gradient (above). Sun at `right:6%; top:26%`, 4.4vw disc + 42vw halo.
- Three **procedural cloud layers** painted to `<canvas>` once on mount (value-noise fBm, 5 octaves, perspective-warped, lit from the sun; shadow colour `rgb(84,58,112)`, lit colour `rgb(255,216,168)`, horizon haze toward `rgb(226,140,96)`). Layers sit at top 34% / 44% / 60%, widths 108–116%. Each frame they drift: `translate(sin(t·.05)·14 − mx·10, p·20)`, `sin(t·.07+1)·22 − mx·26, p·40`, `sin(t·.09+2)·30 − mx·44, p·70` (px; `mx,my` = smoothed mouse offset −.5…+.5). A bitmap cloud PNG per layer is an acceptable substitute.
- Film grain overlay: SVG `feTurbulence` baseFrequency .85, opacity .7, `mix-blend-mode: overlay`. Vignette: `linear-gradient(180deg, rgba(0,0,0,.3), transparent 30%, transparent 55%, rgba(0,0,0,.62))`.
- **Nav** pinned to the top centre, black pill with bottom corners rounded `clamp(16px,1.6vw,24px)`, links 10–14px cream at 80%: *Our story · Villas · For NRIs · Calculator · Contact*. "Calculator" smooth-scrolls to `#calculator`.
- **Villa hero** `width:min(38vw,60vh)`, centred at (50%, 43%), gentle bob `sin(t·.7)·7px`, parallax `−mx·34, −my·14`. Coin (`assets/explore/coin.png`) at 45.5% / −2% of the villa, 9% wide, bobbing `sin(t·1.4)·8px` and spinning `rotateY(t·70deg)`.
- **Copy A** (bottom, 12-col grid): H1 "The Digi Citi" as three spans (`The`, `Digi`, `Citi`) spanning 9 columns; right 3 columns: "A villa in India that pays you rent. *Built by your SIP,* wherever you live." and "│ SCROLL TO SEE HOW". On load each span rises 20px → 0 and fades in, staggered 0 / 80 / 160 / 500 / 700ms after 150ms.

**Scroll choreography (p from 0 → 1):**
- `p 0 → .2`: Copy A fades out and lifts 60px.
- `p .08 → .22`: hero villa fades out and shrinks to 88%.
- `p .10 → .22`: stage tile 05 (villa) fades in at the centre at scale 2.6 and shrinks to 1.5 as `e = ease((p−.14)/.6)` runs.
- `p .16 → .71` (staggered ±.05 by distance from centre): tiles 01–04 fly out from the centre along an arc (`y − sin(ei·π)·.07`) to their final spots — 01 (12%, 50%) scale 1.05, 02 (29%, 41%) 1.12, 03 (71%, 41%) 1.12, 04 (88%, 50%) 1.05 — all bobbing `sin(t·.8 + i·1.3)·6px·e`. Tiles are `15vw` wide, aspect 820/700, glow `drop-shadow(0 0 22px rgba(255,180,110,.32))`.
- `p .66 → .84`: each tile's label fades in below it: number (01–05, 9–12px, tracking .24em), name (Plot / Land cleared / Foundation / Steel frame / Villa), price in Instrument Serif italic (₹1 L, ₹2 L, ₹3 L, ₹4 L, "₹5 L · pays rent" in gold).
- `p .70 → .90`: coin on tile 05 fades in.
- `p .74 → .92`: **Copy B** fades up: kicker "— THEDIGICITI · THE NRI STORY —", the giant "Explore" link with a cream circular arrow button (52–112px) and a pulsing halo (`.55 + .45·sin(t·1.6)` opacity), hover widens the gap; caption "Every villa, *five stages* in the making. Three minutes from plot to rent."
- Centre glow behind the villa dims to 40% by `p .5`.

**Explore click:** frame translates `translateY(38vh) scale(1.08)` over .7s (`cubic-bezier(.55,0,.25,1)`), Copy B fades out .35s, `localStorage['thedigiciti.chapter'] = '0'`, then `tdcVeil.go('story.dc.html', {style:'sky'})` — a full-screen dusk sky fades in over .55s, the story page loads with the same sky already covering it and fades it out over .8s. When returning from the story the frame arrives from `translateY(8vh) scale(1.02)` → none in .45s.

## Screen 2 — Mobile showcase (`#showcase`)

**Layout.** 100vh black section. A fixed `1600 × 1000` stage centred and scaled by `min(vw/1600, vh/1000)`. Header top-left: kicker "DIGIVILLA · DIGI CITY" (13px, .32em, `#7a7c8c`), H1 "Real estate, / **rebuilt as an app.**" (52px/600, second line `#7a7c8c`). Top-right paragraph: "Your SIP builds a city. *The city pays you rent.*" (17px, green accent).

**Phones.** Five `360 × 759` phones in a `perspective: 2400px` rig; the rig tilts with the mouse `rotateY(mx·6deg) rotateX(−my·4deg)` (.6s ease). Bezel: 60px radius, 11px padding, brushed-metal gradient, `inset 0 0 0 1.5px rgba(255,255,255,.18), inset 0 0 0 4px #050506`; 104×30 black island; glass sheen gradient; side buttons as 4px bars; `-webkit-box-reflect: below 14px` fading from 78–80%.
- Far left `left:150 top:250 translateZ(−380) rotateY(40°) scale(.86)` brightness .55 — `screens/villa.png`
- Far right `left:1090` mirrored — `screens/fd.png`
- Mid left `left:400 top:215 translateZ(−150) rotateY(26°) scale(.94)` brightness .78 — `screens/compare.png`
- Mid right `left:840` mirrored — `screens/next.png`
- Centre `left:620 top:178 translateZ(60)` full brightness, purple rim glow — `screens/home.png`
Two radial glows behind (purple `rgba(127,114,224,.16)` 1300×900, green `rgba(143,214,90,.10)` 900×500). Bottom 150px fades to black.

**Caption row** (bottom, 5 equal columns, centred): 01 Inside every villa · 02 Compare anything · **03 Your estate, one glance** (number green, label `#ececf1`) · 04 Next villa, dated · 05 FD, side by side.

## Screen 3 — Calculator (`calculator.dc.html`, also embedded at `#calculator`)

**Layout.** `max-width:1720px`, two panels side by side (`flex-wrap`), left "Your numbers" `flex:1.15 1 460px`, right chart `flex:1.5 1 480px`; both fill the viewport height. Page background `radial-gradient(ellipse 40% 50% at 70% 45%, rgba(108,186,54,.10), transparent 70%), #0b0c12`. Header: title + a pill toggle **FD vs DigiVilla / Flat vs DigiVilla** (42px segments, icons `art/bank.svg`, `art/flat.svg`). Standalone page shows a fixed "← Back to TheDigiCiti" button top-left; embedded, it is hidden.

**Left panel — FD mode** (sections separated by `#1f2233` rules, 22px padding, spread top-to-bottom):
- *You invest* — big value (₹ formatted) with − / + and a ruler/range (₹10 L – ₹5 Cr, step ₹1 L, ± ₹5 L buttons). Default ₹1,00,00,000.
- *FD interest* — chips 6 / 6.5 / 7 / 7.5 / 8 % + "Other" (opens a stepper 3–12 % in .25 steps). Default 6.5.
- *Tax slab* — chips 0 / 5 / 10 / 15 / 20 / 25 / 30 % + "Other" (0–42.7 % in .5 steps). Default 30.
- *Had you started* — 3y / 5y / 8y / 10y / 15y / 20y. Default 8.
- *Monthly income* toggle — on: "₹30,000 a month from the villa (SWP)" (3.6 % a year); off: "everything stays invested".
- Chips: 42px tall, 14px, radius 10px inside a `#0b0c12` tray with `inset 0 0 0 1px #22253a`; selected chip `#8fd65a` background, `#10240a` text.

**Left panel — Flat mode:** four full-width rows (label + hint left, value right; active row outlined `rgba(143,214,90,.6)`): Bought it for / What you paid (₹60 L), Worth today / Market price now (₹90 L), Bought in / Year of purchase (2018), Rent a month / Before tax (₹20,000). Tapping a row points the shared ruler at it. Two summary cards: **Price grew** x.x % a year, **Rent yield** x.x % of value.

**Right panel — chart.** Rounded `#0b0c12` box with a faint 1px grid. A `560 × H` stage scaled to fit. Two isometric columns rise from a common floor:
- Left: FD (grey `#6d7184 → #585c6e`) or Flat; art (`art/bank.svg` / `art/flat.svg`) on top; label "FIXED DEPOSIT · 6.5%" / "FLAT · x% A YEAR".
- Right: DigiVilla (greens `#b9e69a → #9ad471` for "Paid out", `#4f9528 → #2a5e18` for "Value"); `art/villa.svg` with a bobbing `art/coin.svg`; ‹ › buttons flip the profile **Conservative 11 % → Balanced 14 % → Aggressive 17 %** (position "2 / 3" shown).
- Each column stacks two segments (Paid out / Value) with 11px labels and 18px/600 amounts; total above each column at 32px/600, green for the villa.
- A hand-drawn arrow (quadratic SVG path) from the shorter column to the taller one, shown only when the villa is ahead.
- Column heights animate `height .8s cubic-bezier(.2,.8,.2,1)`. Segment min height 48px.
- Verdict line under the chart: "The Balanced villa leaves you ₹X richer than your FD." Footnote: "FD interest taxed at 30 % and paid out. DigiVilla SWP 3.6 % a year, gains taxed at 12.5 % LTCG." (Flat: "Flat cost includes 7 % stamp duty + 1 % brokerage. Rent grew 5 % a year, 11 months a year, 30 % tax on 70 % of rent, 0.4 % upkeep.")

**Maths (port exactly — see `renderVals()` in `calculator.dc.html`):**
- FD paid out = amount × rate × years × (1 − tax). FD value = amount.
- DigiVilla: monthly growth `g = (1 + rate)^(1/12)`; each month `v *= g; paid += mo × (1 − max(0, 1 − amount/v) × 12.5 %); v −= mo` with `mo = amount × .036 / 12` (0 if income off).
- Flat: years = now − bought; appreciation `app = (value/price)^(1/years) − 1`; outlay = price × 1.08; rent kept = Σ rent × 11 / 1.05^(years−t) × (1 − .7×.3) − Σ .004 × price × (1+app)^t; DigiVilla side uses the same SWP loop on `outlay`.
- Currency: Indian grouping, `₹1.2 Cr` / `₹45 L` short form for chart labels.

## Screen 4 — Story (`story.dc.html` + chapters)

**Shell.** Fixed full-screen, night background. Top bar: "← BACK TO / TheDigiCiti" button (cream circle + text), chapter pills **01 The journey · 02 Reading the map · 03 Your numbers**. Chapter changes use a **gold-coin wipe**: a radial night veil clips open from the centre (`clip-path: circle(0 → 150%)`, 1s `cubic-bezier(.7,0,.3,1)`), a spinning gold coin (18vh, `scaleX` 1 → .12 → 1 every 1.6s) with "CHAPTER 0n" and the title, then clips closed over 1.05s. Total 2.6s; chapter remembered in `localStorage['thedigiciti.chapter']`. Each chapter advances to the next when the user scrolls past its last step; chapter 3 returns to the home page's `#showcase`.

**Chapter 1 — The journey (`story-1-journey.dc.html`).** Wheel/touch-driven stepper, 8 stops (`u` 0…7, tweened). Scenes, in order:
1. Home — hint "SCROLL TO TAKE OFF ↓", caption at 30vh.
2. Flight — plane crosses the sky, Gulf caption at 8vh.
3. "YEARS LATER — You worked hard. You saved **₹1 crore.** Now it's time your money worked as hard as you did."
4. "THE REAL QUESTION — Earning it was the easy part. *Where do you put it?*" Two cards fly in: **Fixed deposit** (`assets/bank.png`, "Safe and familiar") and **Real estate** (`assets/real-estate-city.png`, "Something you can see and touch").
5. FD scene — three-column breakdown: safe but taxed, below inflation.
6. Real-estate scene — 4-col bento of pains (stamp duty, tenants, illiquidity…) with a city image in the centre.
7. "THE SOLUTION — So we built a **DigiVilla.** A safe vault that pays you every month, and growth engines that keep your crore worth a crore." (`assets/villa.png` under a gold glow).
8. "ONE VILLA · THREE PROFILES — Performance that fits your profile." Three cards: **CALM** Vault 70 % / Growth 30 % — "Nifty 50's return at a third of its volatility."; **STEADY** 36 / 64 — "More growth, still well below the market's swings."; **BOLD** 20 / 80.

**Chapter 2 — Reading the map (`story-2-map.dc.html`).** One sticky stage with a 1024 × 600 SVG; a pen (SVG) draws each stroke with `stroke-dasharray` / `dashoffset` and a sketchy `feTurbulence` displacement filter; captions in Caveat appear *immediately* while the pen takes its time (1–3 s per shape). One step per scroll:
1. Draw Y axis + arrow ("Returns") and X axis + arrow ("Risk").
2. Caption: "Go up → more return. Go right → more risk."
3. Box the top-left corner in green: "IDEAL SPOT".
4. Erase the box; dot **Arbitrage** bottom-left (green, "less risk, less return") and **Stocks & mutual funds** top-right (red, "high risk, high return"), each with a cloud outline.
5. "BUT THERE'S A BIG PROBLEM — Say you have **₹1 crore.** Where do you put it?"
6. All-in Arbitrage: inflation line drawn across; "capital safe, but you're not beating inflation".
7. All-in stocks: jagged red crash line falling >50 %: "Would you survive the first drop?"
8. "SO HOW DO WE SOLVE IT? — Don't pick one. **Blend them.** Safe enough to sleep. Strong enough to grow." A dashed line joins the two dots; three dots land on it: **Conservative** (green), **Balanced** (gold), **Aggressive** (red).

**Chapter 3 — Your numbers.** The calculator (Screen 3) inside the shell.

---

## Interactions & behaviour summary
- Custom scroll container on the landing; story chapters use wheel / touch / keyboard stepping with a tween (`u → target`, ~.9s), one scene per gesture, locked during the tween.
- Mouse parallax everywhere on the landing and the phone rig (smoothed at 5 %/frame).
- Page transitions: `part-transitions.js` — `tdcVeil.go(url, {style:'sky'})` for home ↔ story, coin veil for chapters. Arrival state is passed through `sessionStorage['tdcVeil']`.
- Prefetch the story pages after load.
- Responsive: landing is fluid (`clamp` + vw); showcase scales a fixed 1600 × 1000 stage; calculator wraps to one column under ~1000px; story stages are designed for ≥ 1024px and should fall back to a simple vertical layout on phones.
- Respect `prefers-reduced-motion`: skip cloud drift, bobbing and the pen animation (show final strokes).

## State
- Landing: scroll progress, smoothed mouse, `leaving` flag.
- Calculator: `mode ('fd'|'flat'), pf (0–2), amount, years, fdRate, tax, income, custom/taxCustom, price, value, bought, rent, active field, k/sh (stage scale)`.
- Story shell: `ch, from, wipe, phase, nxt`; chapters: `u/target` step index.

## Assets (in `assets/`)
- `explore/villa.png` (hero + stage 05), `explore/coin.png`, `explore/bank.png`, `explore/flat.png`, `explore/city.png`, `explore/estate.png`, `explore/vault.png`, `explore/sprout.png`
- `stages/1–5.svg` — flat stage tiles (the detailed ones are the `part-stage-*.dc.html` SVGs)
- `screens/home.png, villa.png, compare.png, next.png, fd.png` — phone screenshots
- `art/bank.svg, flat.svg, villa.svg, coin.svg` — calculator icons
- `villa.png, bank.png, real-estate-city.png, city.png, coin.png, tree.png, vault.png, estate-full.png` — story imagery
- Fonts: Google Fonts (Almarai, Instrument Serif, Inter, Caveat).
