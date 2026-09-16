# Digivilla — marketing website

Static, dependency-free landing page for Digivilla / Digi City. Dark "Nocturne"
palette, Inter, and the isometric art + animations lifted straight from the
client app (`client/frontend`): the sunrise intro, the villa, the five build
stages, the estate board tiles, the rent coin and the fund icons.

## Run

```sh
cd website
python3 -m http.server 4400      # then open http://127.0.0.1:4400/
```

`index.html` is self-contained (all SVG art is inlined), so it also opens
directly from the file system and can be dropped on any static host.

## Edit

- Copy / layout: `src/index.template.html`
- Styles: `styles.css`
- Behaviour (reveal, parallax, pinned build sequence, estate board, calculator): `main.js`
- Art: `assets/stages/*.svg` (from `estate-levels.component.html` and `design/villa-report/tiles-defs.svg`)

After editing the template, rebuild the page:

```sh
python3 build.py                 # writes index.html
```

## Notes

- Copy and numbers come from the "₹1 crore, two ways" deck (`client/frontend/src/app/presentation/deck.data.ts`).
- The footer carries the MFD disclosure with the `ARN-XXXXXX` / entity placeholders — fill these before publishing.
- Honours `prefers-reduced-motion`.
