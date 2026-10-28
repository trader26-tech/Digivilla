import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, computed, inject, signal } from '@angular/core';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AdminService, WorldChart, WorldHistory, WorldQuote } from '../admin.service';
import { Ccy, daily, dayOf, idxAt, isoOf, startOf, today } from './world-compare';

/** what the heat map already knows about a market's session, in words (IST) */
export interface MarketFacts {
  q: WorldQuote;
  state: 'open' | 'pre' | 'closed' | 'nav' | 'always';
  headline: string;          // "Open now" · "Closed" · "Opens soon"
  sub: string;               // "Closes 3:30 pm IST · in 2h 05m"
  hoursIst: string;          // "9:15 am – 3:30 pm IST"
  hoursOwn: string;          // "9:15 am – 3:30 pm in New York" ('' when it is India)
  lastClose: string;         // "Tue 27 Oct · 3:30 pm IST"
  nextOpen: string;          // "Wed 28 Oct · 9:15 am IST · in 17h 40m"
  move: string;              // the 1D move as the heat map shows it
  moveSign: number;
  moveNote: string;          // "Live — since Mon 26 Oct close" / "Final move of Tue 27 Oct"
  price: string;             // "25,966.05"
}

const RANGES = [{ k: '1d', l: '1D' }, { k: '5d', l: '5D' }, { k: '1m', l: '1M' }, { k: '6m', l: '6M' }, { k: 'ytd', l: 'YTD' },
  { k: '1y', l: '1Y' }, { k: '5y', l: '5Y' }, { k: 'max', l: 'Max' }];
const IST = 'Asia/Kolkata';
const VW = 600, VH = 220;

/**
 * One market, tapped on the heat map: is it trading, its hours in IST, the day it last closed,
 * and its chart — 1D … Max or any two dates — scrubbable by finger or mouse.
 */
@Component({
  selector: 'app-market-sheet',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="ms-back" (click)="close.emit()"></div>
<section class="ms" role="dialog" aria-modal="true" [attr.aria-label]="f.q.name">
  <i class="ms-grab" aria-hidden="true"></i>
  <header class="ms-h">
    <div class="ms-t">
      <span class="ms-flag" *ngIf="f.q.flag">{{ f.q.flag }}</span>
      <div><h2>{{ f.q.name }}</h2><small>{{ f.q.exchange || (f.q.kind === 'fund' ? 'AMFI' : '') }}</small></div>
    </div>
    <button class="ms-x" (click)="close.emit()" aria-label="Close">×</button>
  </header>

  <div class="ms-px">
    <b class="num">{{ f.price }}</b>
    <em class="num" [class.pos]="f.moveSign > 0" [class.neg]="f.moveSign < 0">{{ f.move }}</em>
  </div>
  <p class="ms-mn">{{ f.moveNote }}</p>

  <!-- the session, in IST -->
  <div class="ms-ses" [attr.data-s]="f.state">
    <div class="ms-st"><i class="ms-dot"></i><b>{{ f.headline }}</b><span>{{ f.sub }}</span></div>
    <dl>
      <div *ngIf="f.hoursIst"><dt>Trading hours</dt><dd>{{ f.hoursIst }}<small *ngIf="f.hoursOwn">{{ f.hoursOwn }}</small></dd></div>
      <div *ngIf="f.lastClose"><dt>{{ f.state === 'nav' ? 'Latest NAV' : 'Last close' }}</dt><dd>{{ f.lastClose }}</dd></div>
      <div *ngIf="f.nextOpen"><dt>{{ f.state === 'nav' ? 'Next NAV' : 'Next open' }}</dt><dd>{{ f.nextOpen }}</dd></div>
    </dl>
  </div>

  <!-- the chart -->
  <div class="ms-ctl">
    <div class="ms-rg" role="tablist" aria-label="Time frame">
      <ng-container *ngFor="let r of ranges">
        <button role="tab" *ngIf="!(fund && (r.k === '1d' || r.k === '5d'))" [class.on]="range() === r.k" (click)="setRange(r.k)">{{ r.l }}</button>
      </ng-container>
      <button role="tab" [class.on]="range() === 'custom'" (click)="setRange('custom')">Dates</button>
    </div>
    <div class="ms-cc" role="tablist" aria-label="Currency" *ngIf="canUsd">
      <button role="tab" [class.on]="ccy === 'local'" (click)="ccyChange.emit('local')">{{ localLabel }}</button>
      <button role="tab" [class.on]="ccy === 'usd'" (click)="ccyChange.emit('usd')">US$</button>
    </div>
  </div>
  <div class="ms-dates" *ngIf="range() === 'custom'">
    <label>From<input type="date" [min]="minIso()" [max]="maxIso()" [value]="fromIso()" (change)="setFrom($any($event.target).value)" /></label>
    <span>→</span>
    <label>To<input type="date" [min]="minIso()" [max]="maxIso()" [value]="toIso()" (change)="setTo($any($event.target).value)" /></label>
  </div>

  <div class="ms-read">
    <ng-container *ngIf="hoverPt() as h; else whole">
      <span class="num">{{ when(h[0]) }}</span><b class="num">{{ fmt(h[1]) }}</b>
      <em class="num" [class.pos]="h[1] > base()" [class.neg]="h[1] < base()">{{ chg(h[1]) }}</em>
    </ng-container>
    <ng-template #whole>
      <span class="num">{{ span() }}</span>
      <em class="num" *ngIf="pts().length > 1" [class.pos]="last() > base()" [class.neg]="last() < base()">{{ chg(last()) }}</em>
    </ng-template>
  </div>

  <div class="ms-chart" [class.dim]="loading()">
    <svg [attr.viewBox]="'0 0 ' + VW + ' ' + VH" preserveAspectRatio="none"
         (pointermove)="onMove($event)" (pointerdown)="onMove($event)" (pointerleave)="hover.set(null)">
      <defs><linearGradient [attr.id]="gid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" [attr.stop-color]="tone()" stop-opacity=".22" /><stop offset="1" [attr.stop-color]="tone()" stop-opacity="0" /></linearGradient></defs>
      <line *ngIf="baseY() !== null" class="ms-base" x1="0" [attr.x2]="VW" [attr.y1]="baseY()" [attr.y2]="baseY()" vector-effect="non-scaling-stroke" />
      <path *ngIf="area()" [attr.d]="area()" [attr.fill]="'url(#' + gid + ')'" />
      <path *ngIf="path()" [attr.d]="path()" fill="none" [attr.stroke]="tone()" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      <line *ngIf="hoverX() !== null" class="ms-cross" [attr.x1]="hoverX()" [attr.x2]="hoverX()" y1="0" [attr.y2]="VH" vector-effect="non-scaling-stroke" />
    </svg>
    <span class="ms-dotp" *ngIf="hoverXY() as p" [style.left.%]="p[0]" [style.top.%]="p[1]" [style.background]="tone()"></span>
    <span class="ms-y hi num" *ngIf="pts().length">{{ fmt(hi()) }}</span>
    <span class="ms-y lo num" *ngIf="pts().length">{{ fmt(lo()) }}</span>
    <div class="ms-empty" *ngIf="!loading() && pts().length < 2">{{ empty() }}</div>
    <div class="ms-empty" *ngIf="loading() && pts().length < 2">Loading…</div>
  </div>
  <div class="ms-x-ax num" *ngIf="pts().length > 1"><span>{{ axis(pts()[0][0]) }}</span><span>{{ axis(pts()[pts().length - 1][0]) }}</span></div>

  <div class="ms-stats" *ngIf="pts().length > 1">
    <div><small>High</small><b class="num">{{ fmt(hi()) }}</b></div>
    <div><small>Low</small><b class="num">{{ fmt(lo()) }}</b></div>
    <div *ngIf="pa() !== null"><small>A year</small><b class="num" [class.pos]="pa()! > 0" [class.neg]="pa()! < 0">{{ pct(pa()) }}</b></div>
    <div *ngIf="pa() === null"><small>Change</small><b class="num" [class.pos]="last() > base()" [class.neg]="last() < base()">{{ chg(last()) }}</b></div>
  </div>

  <button class="ms-cmp" (click)="compare.emit()">{{ inCompare ? '✓ On the compare chart — remove' : '+ Add to the compare chart' }}</button>
</section>
`,
  styleUrl: './market-sheet.component.scss',
})
export class MarketSheetComponent implements OnChanges {
  private api = inject(AdminService);
  @Input({ required: true }) f!: MarketFacts;
  @Input() ccy: Ccy = 'local';
  @Input() inCompare = false;
  @Output() close = new EventEmitter<void>();
  @Output() compare = new EventEmitter<void>();
  @Output() ccyChange = new EventEmitter<Ccy>();

  readonly VW = VW; readonly VH = VH;
  readonly gid = 'msg' + Math.random().toString(36).slice(2, 8);
  readonly range = signal('1d');
  readonly from = signal<number>(today() - 365);
  readonly to = signal<number>(today());
  readonly hist = signal<WorldHistory | null | undefined>(undefined);
  readonly intra = signal<WorldChart | null | undefined>(undefined);
  readonly loading = signal(false);
  readonly hover = signal<number | null>(null);
  private key = '';
  private intraKey = '';

  get fund(): boolean { return this.f.q.kind === 'fund'; }
  get isYield(): boolean { return this.f.q.kind === 'yield'; }
  /** a currency or yield reads the same in US$; an index in dollars already is US$ */
  get canUsd(): boolean { return !this.isYield && this.f.q.kind !== 'fx' && !!this.f.q.currency && this.f.q.currency !== 'USD'; }
  get localLabel(): string { return ({ INR: '₹', JPY: '¥', EUR: '€', GBP: '£', USD: '$' } as Record<string, string>)[this.f.q.currency || ''] ?? (this.f.q.currency || 'Local'); }
  ranges = RANGES;

  ngOnChanges(): void {
    if (this.f.q.key !== this.key) {
      this.key = this.f.q.key;
      this.hist.set(undefined); this.intra.set(undefined); this.intraKey = ''; this.hover.set(null);
      this.range.set(this.fund ? '1m' : '1d');
    }
    this.load();
  }

  @HostListener('document:keydown.escape') esc(): void { this.close.emit(); }

  setRange(r: string): void {
    if (r === 'custom' && this.range() !== 'custom') {
      // start the date boxes on what is on screen now
      const p = this.pts();
      const a = p.length > 1 ? Math.floor(p[0][0] / 86400) : today() - 365, b = p.length > 1 ? Math.floor(p[p.length - 1][0] / 86400) : today();
      this.to.set(b); this.from.set(b - a < 7 ? b - 365 : a);
    }
    this.range.set(r); this.hover.set(null); this.load();
  }
  setFrom(iso: string): void { if (iso) { this.from.set(dayOf(iso)); if (this.to() < this.from()) this.to.set(this.from()); } }
  setTo(iso: string): void { if (iso) { this.to.set(dayOf(iso)); if (this.from() > this.to()) this.from.set(this.to()); } }

  private get eff(): Ccy { return this.canUsd ? this.ccy : 'local'; }

  private load(): void {
    const r = this.range(), k = this.f.q.key;
    if (r === '1d' || r === '5d') {
      const ik = `${k}|${r}|${this.eff}`;
      if (ik === this.intraKey) return;
      this.intraKey = ik; this.intra.set(undefined); this.loading.set(true);
      this.api.worldChart(k, r, this.eff).pipe(catchError(() => of(null))).subscribe((c) => {
        if (this.intraKey !== ik) return;
        this.intra.set(c); this.loading.set(false);
      });
      return;
    }
    if (this.hist() !== undefined) return;
    this.loading.set(true);
    this.api.worldHistory(k).pipe(catchError(() => of(null))).subscribe((h) => {
      if (this.key !== k) return;
      this.hist.set(h); this.loading.set(false);
    });
  }

  /** [epoch s, value] for the chosen frame */
  readonly pts = computed<[number, number][]>(() => {
    const r = this.range();
    if (r === '1d' || r === '5d') return (this.intra()?.points ?? []).filter((p) => p[1] != null && isFinite(p[1]));
    const h = this.hist(); if (!h) return [];
    const s = daily(h, this.eff); if (!s.d.length) return [];
    const end = r === 'custom' ? this.to() : s.d[s.d.length - 1];
    const start = r === 'custom' ? this.from() : startOf(r, end, s.d[0]);
    const i0 = Math.max(0, idxAt(s, start)), i1 = idxAt(s, end);
    if (i1 <= i0) return [];
    const step = Math.max(1, Math.ceil((i1 - i0) / 500)), out: [number, number][] = [];
    for (let i = i0; i <= i1; i += step) out.push([s.d[i] * 86400, s.v[i]]);
    if (out[out.length - 1][0] !== s.d[i1] * 86400) out.push([s.d[i1] * 86400, s.v[i1]]);
    return out;
  });
  /** what the move is measured from: 1D → the previous close; otherwise the first point */
  readonly base = computed(() => {
    const p = this.pts(), c = this.intra();
    if (this.range() === '1d' && c?.prev_close) return c.prev_close;
    return p.length ? p[0][1] : 0;
  });
  readonly last = computed(() => { const p = this.pts(); return p.length ? p[p.length - 1][1] : 0; });
  readonly hi = computed(() => Math.max(...this.pts().map((p) => p[1])));
  readonly lo = computed(() => Math.min(...this.pts().map((p) => p[1])));
  readonly tone = computed(() => (this.last() >= this.base() ? '#16a085' : '#e53935'));
  /** a year, compounded — only for frames longer than a year */
  readonly pa = computed(() => {
    const p = this.pts(); if (p.length < 2 || this.isYield) return null;
    const yrs = (p[p.length - 1][0] - p[0][0]) / (365.25 * 86400);
    return yrs >= 1.5 && p[0][1] > 0 ? (Math.pow(p[p.length - 1][1] / p[0][1], 1 / yrs) - 1) * 100 : null;
  });
  private readonly scale = computed(() => {
    const p = this.pts(); if (p.length < 2) return null;
    const t0 = p[0][0], t1 = p[p.length - 1][0];
    let lo = Math.min(this.lo(), this.range() === '1d' ? this.base() : Infinity), hi = Math.max(this.hi(), this.range() === '1d' ? this.base() : -Infinity);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08; lo -= pad; hi += pad;
    return { x: (t: number) => ((t - t0) / (t1 - t0 || 1)) * VW, y: (v: number) => VH - ((v - lo) / (hi - lo)) * VH };
  });
  readonly path = computed(() => {
    const s = this.scale(); if (!s) return '';
    return this.pts().map((p, i) => (i ? 'L' : 'M') + s.x(p[0]).toFixed(1) + ',' + s.y(p[1]).toFixed(1)).join('');
  });
  readonly area = computed(() => { const d = this.path(); return d ? `${d}L${VW},${VH}L0,${VH}Z` : ''; });
  readonly baseY = computed(() => { const s = this.scale(); return s && this.range() === '1d' && this.intra()?.prev_close ? s.y(this.base()) : null; });

  onMove(e: PointerEvent): void {
    const p = this.pts(); if (p.length < 2) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const t = p[0][0] + fx * (p[p.length - 1][0] - p[0][0]);
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= t) lo = m; else hi = m; }
    this.hover.set(Math.abs(p[hi][0] - t) < Math.abs(p[lo][0] - t) ? hi : lo);
  }
  readonly hoverPt = computed(() => { const i = this.hover(); return i === null ? null : this.pts()[i] ?? null; });
  readonly hoverX = computed(() => { const h = this.hoverPt(), s = this.scale(); return h && s ? s.x(h[0]) : null; });
  readonly hoverXY = computed(() => { const h = this.hoverPt(), s = this.scale(); return h && s ? [(s.x(h[0]) / VW) * 100, (s.y(h[1]) / VH) * 100] : null; });

  readonly minIso = computed(() => { const h = this.hist(); return h?.d?.length ? isoOf(h.d[0]) : '1970-01-01'; });
  readonly maxIso = computed(() => isoOf(today()));
  readonly fromIso = computed(() => isoOf(this.from()));
  readonly toIso = computed(() => isoOf(this.to()));

  /** the frame in words: "Today's session", "28 Oct 2016 → 27 Oct 2026" */
  readonly span = computed(() => {
    const p = this.pts(), r = this.range();
    if (p.length < 2) return '';
    // the session by the exchange's own date (the US session of Tue ends Wed morning in India)
    if (r === '1d') return 'Session of ' + new Date(p[p.length - 1][0] * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: this.f.q.tz || IST }) + (this.intra()?.prev_close ? ' · vs previous close' : '');
    return this.when(p[0][0], true) + ' → ' + this.when(p[p.length - 1][0], true);
  });
  readonly empty = computed(() => this.range() === 'custom' ? 'No prices between those dates.' : 'No chart for this right now.');

  /** a point's time: intraday → "Tue 27 Oct, 2:45 pm IST"; daily → "27 Oct 2026" */
  when(ts: number, dateOnly = false): string {
    const intraday = this.range() === '1d' || this.range() === '5d';
    const d = new Date(ts * 1000);
    if (intraday && !dateOnly) return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST }).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase()) + ' IST';
    if (intraday) return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  /** under the chart: 1D → IST clock times, otherwise dates */
  axis(ts: number): string {
    if (this.range() !== '1d') return this.when(ts, true);
    return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST }).replace(' AM', ' am').replace(' PM', ' pm') + ' IST';
  }
  fmt(v: number | null): string {
    if (v === null || !isFinite(v)) return '—';
    if (this.isYield) return v.toFixed(3) + '%';
    const dp = Math.abs(v) < 10 ? 4 : 2, sym = this.fund ? '₹' : this.eff === 'usd' ? '$' : '';
    return sym + v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  chg(v: number): string {
    const b = this.base(); if (!b) return '';
    if (this.isYield) { const d = (v - b) * 100; return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(0) + ' bp'; }
    return this.pct((v / b - 1) * 100);
  }
  pct(v: number | null): string { return v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; }
}
