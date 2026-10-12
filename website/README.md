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

| Page | Screen |
|---|---|
| `index.html` | Landing + mobile showcase (`#showcase`) + calculator (`#calculator`) |
| `story.html` | Story shell (Explore lands here) — chapter 2, Reading the map |
| `story-1-journey.html` | Chapter 1 — the journey ("Our story") |
| `story-2-map.html` | Chapter 2 standalone ("For NRIs") |
| `story-3-numbers.html` | Chapter 3 — calculator inside the story |
| `calculator.html` | Calculator, standalone |

## Hosting

Railway service **Website - TheDigiCiti** (project Digivilla), built from
`Dockerfile` (Caddy serving the folder; see `Caddyfile`). Deploy from a clean
export of this folder:

```sh
git archive HEAD website | tar -x -C /tmp/tdc && \
  railway up /tmp/tdc/website --path-as-root --service "Website - TheDigiCiti" --detach
```
