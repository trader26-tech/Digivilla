#!/usr/bin/env python3
"""Assemble website/index.html from src/index.template.html.

Inlines the isometric art lifted from the client app so the page is a single
self-contained HTML file (works from file:// as well as any static host):
  - assets/stages/{plot,grading,foundation,steel,villa}.svg  -> the pinned build sequence
  - assets/stages/tiles-defs.svg                             -> the estate board symbols
  - the villa-art polygons                                   -> hero villa + mini villas
Run:  python3 build.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
tpl = (ROOT / 'src' / 'index.template.html').read_text()

def stage(name):
    return (ROOT / 'assets' / 'stages' / f'{name}.svg').read_text().strip()

villa_full = stage('villa')
# the villa polygons without the dark plinth (first three polygons) — for the hero / mini marks
inner = re.search(r'<svg[^>]*>(.*)</svg>', villa_full, re.S).group(1)
parts = re.findall(r'<(?:polygon|polyline|rect)[^>]*>(?:</(?:polygon|polyline|rect)>)?', inner)
villa_no_plinth = ''.join(parts[3:])

units = '<i></i>' * 100

tiles = (ROOT / 'assets' / 'stages' / 'tiles-defs.svg').read_text()

land = ('<svg viewBox="88 60 644 468" aria-hidden="true"><polygon points="721.8,264 410,444 410,516 721.8,336" fill="#8a5a33"/>'
        '<polygon points="410,444 98.2,264 98.2,336 410,516" fill="#6d4527"/><polygon points="721.8,264 410,444 410,458 721.8,278" fill="#3f2a18" opacity="0.35"/>'
        '<polygon points="721.8,250 410,430 410,444 721.8,264" fill="#59a52e"/><polygon points="410,430 98.2,250 98.2,264 410,444" fill="#3f7a20"/>'
        '<polygon points="410,70 721.8,250 410,430 98.2,250" fill="#6cba36"/><polygon points="410,70 721.8,250 410,430 98.2,250" fill="none" stroke="#3f7a20" stroke-width="8"/></svg>')
coin = ('<svg viewBox="-20 -20 40 60" aria-hidden="true"><ellipse class="cf-shadow" cx="0" cy="30" rx="13" ry="4.5"/><g class="coin-float"><circle class="cf-face" r="15"/>'
        '<circle class="cf-ring" r="10"/><circle class="cf-shine" cx="-3.8" cy="-4.5" r="3"/><text class="cf-glyph" x="0" y="5.5" text-anchor="middle">₹</text></g></svg>')

out = (tpl
       .replace('<!--LAND-->', land)
       .replace('<!--COIN-->', coin)
       .replace('<!--VILLA_ART-->', villa_no_plinth)
       .replace('<!--VILLA_MINI-->', villa_no_plinth)
       .replace('<!--UNITS-->', units)
       .replace('<!--TILE_DEFS-->', tiles)
       .replace('<!--STAGE_PLOT-->', stage('plot'))
       .replace('<!--STAGE_GRADING-->', stage('grading'))
       .replace('<!--STAGE_FOUNDATION-->', stage('foundation'))
       .replace('<!--STAGE_STEEL-->', stage('steel'))
       .replace('<!--STAGE_VILLA-->', villa_full))

(ROOT / 'index.html').write_text(out)
print(f'index.html written · {len(out)/1024:.0f} KB')
