# TheDigiCiti — website

The marketing site: dusk landing with the villa that splits into its five build
stages, the 3‑D phone showcase, the FD / Flat vs DigiVilla calculator, and the
story pages (the journey, reading the map, your numbers).

## How it is built

The design handoff is the source of truth and lives in `_source/design/`
(`*.dc.html` + `README.md`, `BRAND.md`). Each `.dc.html` is inline‑styled markup
with `{{ holes }}`, `<sc-if>` / `<sc-for>` / `<dc-import>` and a `Component` class.

`_source/build.py` compiles every design file into a plain ES module in `dc/`
that renders with Preact (vendored, `dc/vendor/preact.mjs`) through `dc/rt.js`,
and writes one HTML page per screen. The component logic (scroll choreography,
clouds, calculator maths, chapter stepping) is carried over verbatim, so the
site matches the prototype frame for frame — without its in‑browser compiler.

```sh
cd website
python3 _source/build.py          # after editing anything in _source/
python3 -m http.server 4500       # then open http://127.0.0.1:4500/
```

Never edit `dc/` or the `*.html` pages by hand — they are regenerated.

### Where the build goes beyond the prototype

The prototype's look and timing are kept; what changed is how it runs:

- **Shadows are baked, not filtered.** The villa and the five stage tiles had
  stacked CSS `drop-shadow` filters on elements that move every frame — several
  large blur passes per frame. `rt.bakeFilter` renders each filter once into a
  canvas (same picture) and swaps it in.
- **Smoothing is time-based** (scroll progress, mouse parallax), so the feel is
  identical at 30, 60 or 120 Hz. Per-frame DOM writes are skipped when nothing
  changed, the phone rig only turns while on screen, and the landing loop idles
  once the calculator is reached.
- **One scene per wheel gesture** in the story (`rt.wheelStepper`): a trackpad
  flick is one step, a scroll that is still rolling when a scene lands does not
  fire the next one.
- **Nothing flashes in.** Fonts are self-hosted and preloaded
  (`assets/fonts`); the landing copy rises and the page veil lifts only once
  fonts and first-screen images are decoded (`rt.ready`).
- **Images are ~5× lighter** (WebP screens, a 320 px coin, pruned unused art).
- **Reduced motion** is honoured: no drift, bob or parallax; the pen draws
  instantly.
- **Phones** get a real showcase layout (heading above a width-fitted stage).

| Page | Screen |
|---|---|
| `index.html` | Landing + mobile showcase (`#showcase`) + calculator (`#calculator`) |
| `story.html` | The story: all three chapters with pills and the gold-coin wipe. Explore lands on chapter 1; `#1` / `#2` / `#3` open a chapter; the last chapter remembered in `localStorage['thedigiciti.chapter']`. Past chapter 3 → `index.html#showcase`. |
| `story-1-journey.html` | Chapter 1 on its own — the flight / NRI journey |
| `story-2-map.html` | Chapter 2 on its own — the pen-drawn return / risk map |
| `story-3-numbers.html` | Chapter 3 on its own — the calculator in story form |
| `calculator.html` | Calculator, standalone |

The zip's `story.dc.html` only mounted chapter 2; the shell in `_source/design/story.dc.html`
was completed to what the handoff README describes (three chapters, pills, wipe, hand-off
to the showcase). The landing nav points into the shell (`#1`, `#2`).

## Hosting

Railway service **Website - TheDigiCiti** (project Digivilla), built from
`Dockerfile` (Caddy serving the folder; see `Caddyfile`). Deploy from a clean
export of this folder:

```sh
git archive HEAD website | tar -x -C /tmp/tdc && \
  railway up /tmp/tdc/website --path-as-root --service "Website - TheDigiCiti" --detach
```
