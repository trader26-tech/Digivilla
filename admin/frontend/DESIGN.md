# Digivilla admin — the "Markets today" design language — the house style (2026-10-19)

The user's words: "change the entire UI UX of the application to the same UI UX of the Markets today page … as minimal text as possible … great great UI UX". The reference implementation is
`admin/frontend/src/app/global/global-markets.component.{html,scss,ts}` — read both the html and the scss before you start.

## Tokens (global in src/styles.scss — use them, never raw hex except where noted)
- page `--nw-bg` #f2f4fb · card `--nw-card` #fff · inset `--nw-card2` #f5f7fb · border `--nw-border` #e0e4f0
- text `--nw-text` #1a1c2e · muted `--nw-muted` #6b7190 · accent `--nw-accent` #387ed1 (hover #2d6db8)
- gains `--nw-pos` #16a085 · falls `--nw-neg` #e53935 · warning `--nw-warn` #d97706
- card shadow `--nw-shadow` · radius `--nw-radius` (16px; 12–14px for inner tiles/rows)
- The legacy tokens (--ink --paper --brass --surface-2 --border --muted --positive --negative) are REMAPPED to these, so old rules already pick them up. The root font-size is now 14px.
- Font: -apple-system, 'Inter', … (already global). Numbers: `font-variant-numeric: tabular-nums`.

## Shapes
- Cards: white, 1px border, radius 16, `box-shadow: var(--nw-shadow)`, padding 14px 16px. Inner tiles/rows: `--nw-card2` background, radius 12, 1px border or none.
- Page head: h1 26px/800/-.6px; under it ONE line of 12.5px/600 muted meta (date · state · "updated 2 min ago"). No paragraphs.
- KPI bar (`.kbar/.kb` in the reference): uppercase 10.5px/700/.5px muted label, 20px/800 value, 12px/800 change with ▲/▼ in pos/neg.
- Entity cards (`.pcard`): 14px/800 name, small uppercase 10.5px tag on the right, 24–28px/800 big number, a 11.5px muted sub-line, label/value rows at 12px, dashed divider, blue 11px/700 action link. Hover: border + shadow lift. Selected: blue ring.
- Segmented control (`.seg`): grey inset group, 12px/700 muted buttons, active = solid accent blue with white text, 1px dividers.
- Buttons: primary = accent blue, white text, radius 9, 13px/800, padding 9px 16px, no heavy shadow. Ghost = white, 1px border, hover border accent + #f3f8ff.
- Pills for a day move: 11px/800, radius 999, bg #e7f6f1 (teal text) or #fdeeee (red text).
- Group captions: 10.5px/800 uppercase .6px muted.
- Status colour only on gains/falls/warnings — never as decoration. Series colours only on marks, never on text.
- Tables: 10px uppercase muted headers, 12px rows, hairline `--nw-border` row borders, hover row bg `--nw-card2`.

## Minimal text (the user's hard rule)
- Delete explanatory paragraphs, hints, "how this works" prose, long captions. If something must be explained, put it behind an (i) button (`.pf-i` in the reference) that opens a small popover.
- Titles ≤ 3 words. Labels one or two words. Let the numbers talk. Never repeat a number in words.
- Keep EVERY feature, control, binding and data flow; only the presentation changes. Do not remove functionality to "simplify".

## Rules
- Class names must not collide with the global shell: never use `.dash`, `.sw`, `.side`, `.mbar`, `.tabbar`, `.more-*`, `.upd` for page elements.
- Phone first: ≤ 900 px the shell shows a top bar + bottom tab bar (`--tabbar-h`); anything bottom-fixed offsets by it. At 390 px the page must not scroll sideways. Tap targets ≥ 36 px.
- `app.component.scss` has a hard 60 kB error budget: remove old rules rather than add.
- Verify in WebKit (the user is on Safari) at 1440 / 1180 / 390 px.
