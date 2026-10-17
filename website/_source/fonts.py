#!/usr/bin/env python3
"""Rebuild the site's web fonts (assets/fonts/*.woff2 + fonts.css) — small, subset, one file per face.

The site is English + ₹, so every font is cut down to what it can draw here:

  Inter            body text. ONE variable file (Google Fonts css2, latin, wght axis limited to
                   400–600 — the weights the pages ask for; 700 requests clamp to 600 as before),
                   ASCII + Latin-1 symbols + punctuation, every OpenType feature kept (the design
                   system turns on tnum). ₹ comes from a separate ~1 KB face (unicode-range U+20B9).
  Almarai          landing headings/copy: 400, 700, 800 only (500→400, 600→700 by CSS matching;
                   300 was never used). ASCII + typographic punctuation.
  Instrument Serif the landing's italic accent line + the upright for the phone cover's title. ASCII + punctuation.
  Caveat           the pen-drawn labels (story map, Explore). Static 700 (the only weight used),
                   ASCII + ₹ + punctuation. Arrows / ≈ are not in Caveat — they fall back as before.

font-display: Instrument Serif (the landing's accent line, 10 KB, preloaded first in <head>, so it is
in before the page mounts) is optional — text never waits on it. Caveat stays swap: it is only laid out
after the page's JS mounts, and with optional a cold 3G/4G load missed the 100 ms window and drew every
pen label in the system cursive (Apple Chancery / Snell Roundhand) for the whole visit; the page veil
(rt.ready) already hides the swap. Inter and Almarai: swap. No latin-ext / cyrillic files at all.

    python3 -m venv /tmp/ftv && /tmp/ftv/bin/pip install fonttools brotli
    /tmp/ftv/bin/python _source/fonts.py          # from website/ ; then python3 _source/build.py
"""
import io
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'fonts'
CHROME = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')
GH = 'https://github.com/google/fonts/raw/main/ofl/'

ASCII = list(range(0x20, 0x7F))
# typographic punctuation and the signs the copy uses: nbsp · × ‘ ’ “ ” – — … ← → ↑ ↓ ≈ − ₹ %
PUNCT = [0xA0, 0xB7, 0xD7, 0x2018, 0x2019, 0x201C, 0x201D, 0x2013, 0x2014, 0x2026,
         0x2190, 0x2191, 0x2192, 0x2193, 0x2248, 0x2212, 0x20B9]
INTER = (ASCII + list(range(0xA0, 0xC0)) + [0xD7, 0xF7] + list(range(0x2010, 0x2028))
         + list(range(0x2030, 0x203B)) + [0x2044, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2215])


def fetch(url: str, ua: str = CHROME) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def css2_file(query: str, block: str = 'latin') -> bytes:
    """The woff2 the Google Fonts css2 API serves Chrome for one /* <block> */ (or the only one)."""
    css = fetch('https://fonts.googleapis.com/css2?' + query).decode()
    parts = re.split(r'/\* ([\w-]+) \*/', css)
    blocks = dict(zip(parts[1::2], parts[2::2])) if len(parts) > 1 else {block: css}
    m = re.search(r'url\((https://[^)]+)\)', blocks[block])
    return fetch(m.group(1))


def load(data: bytes) -> TTFont:
    return TTFont(io.BytesIO(data))


def reload(font: TTFont) -> TTFont:
    """instancer output → bytes → a fresh TTFont (the subsetter trips over lazily loaded gvar otherwise)."""
    b = io.BytesIO()
    font.save(b)
    b.seek(0)
    return TTFont(b)


def ranges(cps) -> str:
    cps, out = sorted(set(cps)), []
    i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f'U+{cps[i]:04X}' + (f'-{cps[j]:04X}' if j > i else ''))
        i = j + 1
    return ','.join(out)


def cut(font: TTFont, codepoints, name: str, all_features=False) -> str:
    """Subset + save as woff2; returns the unicode-range the file really covers."""
    font = reload(font)
    o = subset.Options()
    if all_features:
        o.layout_features = ['*']
    # else: fontTools' default-on shaping features (calt, kern, liga, ccmp, locl, mark …) —
    # stylistic sets / salt / sups never render here, their glyphs are dead weight
    o.flavor = 'woff2'
    o.hinting = False
    o.desubroutinize = True
    o.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    o.notdef_outline = True
    s = subset.Subsetter(o)
    s.populate(unicodes=codepoints)
    s.subset(font)
    font.flavor = 'woff2'
    font.save(OUT / name)
    have = [c for c in font.getBestCmap() if c in set(codepoints)]      # what the file really draws
    print(f'{name:40} {(OUT / name).stat().st_size:6d} B  {len(font.getGlyphOrder())} glyphs')
    return ranges(have)


def face(family, weight, file, urange, display, style='normal') -> str:
    return (f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};font-display:{display};"
            f"src:url({file}) format('woff2');unicode-range:{urange}}}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.woff2'):
        old.unlink()
    css = ['/* Built by _source/fonts.py — subset web fonts, English + ₹ only (no latin-ext). Do not hand-edit. */']

    inter = instancer.instantiateVariableFont(load(css2_file('family=Inter:wght@400..600')), {'wght': (400, 600)})
    css.append(face('Inter', '400 600', 'Inter-latin.woff2', cut(inter, INTER, 'Inter-latin.woff2', all_features=True), 'swap'))
    rupee = instancer.instantiateVariableFont(
        load(css2_file('family=Inter:wght@400..600&text=' + urllib.parse.quote('₹'))), {'wght': (400, 600)})
    css.append('/* ₹ on its own, so no big file is fetched just for the rupee sign */')
    css.append(face('Inter', '400 600', 'Inter-rupee.woff2', cut(rupee, [0x20B9], 'Inter-rupee.woff2', all_features=True), 'swap'))

    for w in (400, 700, 800):
        f = load(css2_file(f'family=Almarai:wght@{w}'))
        css.append(face('Almarai', w, f'Almarai-{w}-latin.woff2', cut(f, ASCII + PUNCT, f'Almarai-{w}-latin.woff2'), 'swap'))

    css.append('/* decorative */')
    serif = load(fetch(GH + 'instrumentserif/InstrumentSerif-Italic.ttf'))
    css.append(face('Instrument Serif', 400, 'InstrumentSerif-400-italic-latin.woff2',
                    cut(serif, ASCII + PUNCT, 'InstrumentSerif-400-italic-latin.woff2'), 'optional', style='italic'))
    upright = load(fetch(GH + 'instrumentserif/InstrumentSerif-Regular.ttf'))      # the phone cover's title
    css.append(face('Instrument Serif', 400, 'InstrumentSerif-400-latin.woff2',
                    cut(upright, ASCII + PUNCT, 'InstrumentSerif-400-latin.woff2'), 'swap'))
    caveat = instancer.instantiateVariableFont(load(fetch(GH + 'caveat/Caveat%5Bwght%5D.ttf')), {'wght': 700})
    css.append(face('Caveat', 700, 'Caveat-700-latin.woff2', cut(caveat, ASCII + PUNCT, 'Caveat-700-latin.woff2'), 'swap'))

    (OUT / 'fonts.css').write_text('\n'.join(css) + '\n')
    print('wrote', OUT / 'fonts.css')


if __name__ == '__main__':
    sys.exit(main())
