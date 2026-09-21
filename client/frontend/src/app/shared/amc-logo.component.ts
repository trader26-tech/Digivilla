import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** One fund house: how to spot it in a scheme name + its brand badge. */
interface Amc { slug: string; match: RegExp; mark: string; bg: string; fg: string; }

/**
 * Fund houses, matched against the START of the scheme name. Order matters only
 * where one name prefixes another. `bg`/`fg` are the house's brand colours;
 * `mark` is the short wordmark shown on the badge.
 */
const AMCS: Amc[] = [
  { slug: 'sbi',        match: /^sbi\b/i,                          mark: 'SBI',   bg: '#22409a', fg: '#ffffff' },
  { slug: 'nippon',     match: /^nippon\b/i,                       mark: 'N',     bg: '#d7182a', fg: '#ffffff' },
  { slug: 'hdfc',       match: /^hdfc\b/i,                         mark: 'HDFC',  bg: '#004c8f', fg: '#ffffff' },
  { slug: 'icici',      match: /^icici\b/i,                        mark: 'ICICI', bg: '#ae282e', fg: '#ffd9a0' },
  { slug: 'kotak',      match: /^kotak\b/i,                        mark: 'K',     bg: '#ed1c24', fg: '#ffffff' },
  { slug: 'axis',       match: /^axis\b/i,                         mark: 'AXIS',  bg: '#97144d', fg: '#ffffff' },
  { slug: 'absl',       match: /^(aditya\s+birla|absl|birla)\b/i,  mark: 'ABSL',  bg: '#c8102e', fg: '#ffd166' },
  { slug: 'uti',        match: /^uti\b/i,                          mark: 'UTI',   bg: '#0f4c9a', fg: '#ffffff' },
  { slug: 'dsp',        match: /^dsp\b/i,                          mark: 'DSP',   bg: '#101114', fg: '#ffffff' },
  { slug: 'mirae',      match: /^mirae\b/i,                        mark: 'M',     bg: '#f58220', fg: '#10294d' },
  { slug: 'ppfas',      match: /^(parag\s+parikh|ppfas)\b/i,       mark: 'PP',    bg: '#0b6b3f', fg: '#ffffff' },
  { slug: 'tata',       match: /^tata\b/i,                         mark: 'TATA',  bg: '#1f4e9c', fg: '#ffffff' },
  { slug: 'motilal',    match: /^motilal\b/i,                      mark: 'MO',    bg: '#f9a01b', fg: '#1d1d1d' },
  { slug: 'quant',      match: /^quant\b/i,                        mark: 'q',     bg: '#15161a', fg: '#ffffff' },
  { slug: 'quantum',    match: /^quantum\b/i,                      mark: 'Q',     bg: '#0a5ba8', fg: '#ffffff' },
  { slug: 'bandhan',    match: /^(bandhan|idfc)\b/i,               mark: 'B',     bg: '#c8102e', fg: '#ffffff' },
  { slug: 'franklin',   match: /^franklin\b/i,                     mark: 'FT',    bg: '#005598', fg: '#ffffff' },
  { slug: 'invesco',    match: /^invesco\b/i,                      mark: 'INV',   bg: '#000ad2', fg: '#ffffff' },
  { slug: 'edelweiss',  match: /^edelweiss\b/i,                    mark: 'E',     bg: '#1d3c7d', fg: '#ffffff' },
  { slug: 'canara',     match: /^canara\b/i,                       mark: 'CR',    bg: '#0091d0', fg: '#ffffff' },
  { slug: 'hsbc',       match: /^hsbc\b/i,                         mark: 'HSBC',  bg: '#db0011', fg: '#ffffff' },
  { slug: 'pgim',       match: /^pgim\b/i,                         mark: 'PGIM',  bg: '#07639d', fg: '#ffffff' },
  { slug: 'sundaram',   match: /^sundaram\b/i,                     mark: 'S',     bg: '#0e4da4', fg: '#ffffff' },
  { slug: 'lic',        match: /^lic\b/i,                          mark: 'LIC',   bg: '#0c4da2', fg: '#fdb913' },
  { slug: 'whiteoak',   match: /^(whiteoak|white\s+oak|woc)\b/i,   mark: 'WOC',   bg: '#1c3a2e', fg: '#ffffff' },
  { slug: 'baroda',     match: /^baroda\b/i,                       mark: 'BNP',   bg: '#f26522', fg: '#ffffff' },
  { slug: 'mahindra',   match: /^mahindra\b/i,                     mark: 'MM',    bg: '#e31837', fg: '#ffffff' },
  { slug: 'union',      match: /^union\b/i,                        mark: 'U',     bg: '#d2232a', fg: '#ffffff' },
  { slug: 'jm',         match: /^jm\b/i,                           mark: 'JM',    bg: '#003a70', fg: '#ffffff' },
  { slug: 'iti',        match: /^iti\b/i,                          mark: 'ITI',   bg: '#7a1f2b', fg: '#ffffff' },
  { slug: 'bajaj',      match: /^bajaj\b/i,                        mark: 'BF',    bg: '#0066b3', fg: '#ffffff' },
  { slug: '360one',     match: /^(360\s*one|iifl)\b/i,             mark: '360',   bg: '#1a1a1a', fg: '#f3c969' },
  { slug: 'zerodha',    match: /^zerodha\b/i,                      mark: 'Z',     bg: '#387ed1', fg: '#ffffff' },
  { slug: 'groww',      match: /^groww\b/i,                        mark: 'G',     bg: '#00b386', fg: '#ffffff' },
  { slug: 'navi',       match: /^navi\b/i,                         mark: 'N',     bg: '#0d7a5f', fg: '#ffffff' },
  { slug: 'samco',      match: /^samco\b/i,                        mark: 'S',     bg: '#e8461e', fg: '#ffffff' },
  { slug: 'helios',     match: /^helios\b/i,                       mark: 'H',     bg: '#f08a1c', fg: '#1d1d1d' },
  { slug: 'nj',         match: /^nj\b/i,                           mark: 'NJ',    bg: '#1b4f9c', fg: '#ffffff' },
  { slug: 'boi',        match: /^bank\s+of\s+india\b/i,            mark: 'BOI',   bg: '#f47920', fg: '#10294d' },
];

/**
 * Fund houses that have an official logo file at
 * `public/assets/amc/<slug>.svg`. Add a slug here after dropping its file in and
 * the badge shows the artwork instead of the wordmark (falls back if it 404s).
 */
const LOGO_FILES = new Set<string>([]);

/** Quiet, distinct backgrounds for a fund house that is not in AMCS. */
const FALLBACK_BG = ['#3b4a7a', '#5a3f7a', '#2f6b62', '#7a5a2f', '#6b3347', '#35607d'];

/**
 * FUND-HOUSE BADGE — the logo tile beside every fund.
 *
 *   <app-amc-logo [name]="f.scheme_name"></app-amc-logo>
 *
 * Resolves the fund house from the scheme name and paints its brand-coloured
 * wordmark tile, or its official logo file when one is registered in LOGO_FILES.
 */
@Component({
  selector: 'app-amc-logo',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="amc" [style.background]="img ? '#ffffff' : 'var(--amc-bg, #262a38)'" [style.color]="img ? fg : 'var(--amc-fg, #c9c6da)'"
          [attr.data-len]="mark.length" aria-hidden="true">
      <img *ngIf="img" [src]="img" alt="" (error)="img = ''" />
      <b *ngIf="!img">{{ mark }}</b>
    </span>
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .amc {
      width: var(--amc-size, 42px); height: var(--amc-size, 42px); border-radius: 13px;
      display: grid; place-items: center; overflow: hidden;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
    }
    .amc b { font: 700 15px/1 Inter, system-ui, sans-serif; letter-spacing: -.02em; }
    .amc[data-len="3"] b { font-size: 12.5px; }
    .amc[data-len="4"] b { font-size: 10.5px; letter-spacing: 0; }
    .amc[data-len="5"] b { font-size: 9.5px; letter-spacing: 0; }
    .amc img { width: 100%; height: 100%; object-fit: contain; padding: 5px; }
  `],
})
export class AmcLogoComponent {
  mark = '';
  bg = FALLBACK_BG[0];
  fg = '#ffffff';
  /** The brand colour lifted so it stays legible as a MARK on the dark neutral
   *  tile (deep blues/reds like Edelweiss or HDFC vanish otherwise). */
  get markColour(): string {
    const m = /^#([0-9a-f]{6})$/i.exec(this.bg); if (!m) return this.bg;
    const n = parseInt(m[1], 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const t = lum < 110 ? 0.45 : lum < 160 ? 0.25 : 0.1;          // darker brand → more lift
    r = Math.round(r + (255 - r) * t); g = Math.round(g + (255 - g) * t); b = Math.round(b + (255 - b) * t);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }
  img = '';

  @Input() set name(v: string) {
    const n = (v || '').trim();
    const amc = AMCS.find(a => a.match.test(n));
    if (amc) {
      this.mark = amc.mark; this.bg = amc.bg; this.fg = amc.fg;
      this.img = LOGO_FILES.has(amc.slug) ? `assets/amc/${amc.slug}.svg` : '';
      return;
    }
    // unknown house: its initials on a colour picked stably from the name
    const words = n.split(/\s+/).filter(Boolean);
    this.mark = ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '₹';
    let h = 0;
    for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    this.bg = FALLBACK_BG[h % FALLBACK_BG.length];
    this.fg = '#ffffff';
    this.img = '';
  }
}
