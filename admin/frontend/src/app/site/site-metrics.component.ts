import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AdminService, SiteMetrics } from '../admin.service';

/** thedigiciti.com — of the people who saw the site, how many opened Explore and how many tapped WhatsApp. */
@Component({
  selector: 'app-site-metrics',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="sm">
  <header class="land-head">
    <div>
      <h1>Website</h1>
      <div class="upd-row"><span class="upd-date">thedigiciti.com</span>@if (d(); as m) { <span class="upd-src num">{{ day(m.from) }} – {{ day(m.to) }}</span> }</div>
    </div>
    <div class="seg" role="radiogroup" aria-label="Range">
      @for (r of RANGES; track r.k) { <button role="radio" [attr.aria-checked]="days() === r.k" [class.on]="days() === r.k" (click)="setDays(r.k)">{{ r.l }}</button> }
    </div>
  </header>

  @if (d(); as m) {
    <section class="kbar" aria-label="Headline">
      <div class="kb"><span class="kb-k">Saw the site</span><span class="kb-v num">{{ m.visitors }}</span><span class="kb-c num">{{ m.counts.view }} page views</span></div>
      <div class="kb"><span class="kb-k">Opened Explore</span><span class="kb-v num">{{ m.people.explore }}</span><span class="kb-c num">{{ m.explore_pct }}% of visitors</span></div>
      <div class="kb"><span class="kb-k">Tapped WhatsApp</span><span class="kb-v num pos">{{ m.people.whatsapp }}</span><span class="kb-c num">{{ m.whatsapp_pct }}% of visitors</span></div>
    </section>

    <section class="card fn" aria-label="Funnel">
      <div class="card-head"><h3>Funnel</h3><span class="card-sub">people</span></div>
      @for (s of steps(); track s.k) {
        <div class="fn-row">
          <span class="fn-k">{{ s.k }}</span>
          <span class="fn-bar"><i [style.width.%]="s.w" [style.background]="s.c"></i></span>
          <b class="num">{{ s.n }}</b><span class="fn-p num">{{ s.p }}</span>
        </div>
      }
    </section>

    <section class="card ch" aria-label="By day">
      <div class="card-head"><h3>By day</h3>
        <span class="lg"><i style="background:#c9d6ea"></i>Saw <i style="background:#387ed1"></i>Explore <i style="background:#16a085"></i>WhatsApp</span></div>
      <div class="bars">
        @for (b of bars(); track b.day) {
          <div class="col" [title]="day(b.day) + ' · ' + b.view + ' saw · ' + b.explore + ' explore · ' + b.whatsapp + ' WhatsApp'">
            <span class="stk">
              <i class="v" [style.height.%]="b.hv"></i>
              <i class="e" [style.height.%]="b.he"></i>
              <i class="w" [style.height.%]="b.hw"></i>
            </span>
            @if (b.lbl) { <small>{{ b.lbl }}</small> }
          </div>
        }
      </div>
    </section>

    <div class="two">
      <section class="card ls"><div class="card-head"><h3>Where from</h3></div>
        @for (r of m.refs; track r.source) { <div class="li"><span>{{ r.source }}</span><b class="num">{{ r.visits }}</b></div> } @empty { <p class="none">No visits yet</p> }
      </section>
      <section class="card ls"><div class="card-head"><h3>Pages</h3></div>
        @for (p of m.pages; track p.page) { <div class="li"><span>{{ p.page }}</span><b class="num">{{ p.views }}</b></div> } @empty { <p class="none">No visits yet</p> }
      </section>
    </div>
  } @else if (err()) {
    <div class="banner err">Could not load <button class="btn" (click)="load()">Try again</button></div>
  } @else {
    <div class="sk"><i></i><i class="t"></i></div>
  }
</div>`,
  styles: [`
:host { display: block; }
.sm { max-width: 1100px; margin: 0 auto; padding: 18px 32px 40px; }
.land-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap;
  h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -.6px; line-height: 1.15; } }
.upd-row { display: flex; gap: 10px; margin-top: 3px; font-size: 12.5px; font-weight: 600; color: var(--nw-muted); .upd-date { font-weight: 800; color: var(--nw-text); } .upd-src::before { content: '·'; margin-right: 10px; } }
.seg { display: inline-flex; background: var(--nw-card2); border: 1px solid var(--nw-border); border-radius: 9px; overflow: hidden;
  button { background: none; border: none; padding: 6px 12px; font: inherit; font-size: 12px; font-weight: 700; color: var(--nw-muted); cursor: pointer; & + button { border-left: 1px solid var(--nw-border); } &.on { background: var(--nw-accent); color: #fff; } } }
.kbar { display: flex; flex-wrap: wrap; background: var(--nw-card); border: 1px solid var(--nw-border); border-radius: 16px; padding: 12px 10px; margin-bottom: 12px; box-shadow: var(--nw-shadow); }
.kb { flex: 1 1 150px; padding: 4px 18px; display: flex; flex-direction: column; gap: 3px;
  .kb-k { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--nw-muted); }
  .kb-v { font-size: 28px; font-weight: 800; letter-spacing: -.6px; line-height: 1.1; font-variant-numeric: tabular-nums; &.pos { color: var(--nw-pos); } }
  .kb-c { font-size: 12px; font-weight: 700; color: var(--nw-muted); } }
.card { background: var(--nw-card); border: 1px solid var(--nw-border); border-radius: 16px; padding: 14px 16px; box-shadow: var(--nw-shadow); margin-bottom: 12px; }
.card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; h3 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -.3px; } }
.card-sub { font-size: 11.5px; font-weight: 700; color: var(--nw-muted); }
.fn-row { display: grid; grid-template-columns: 130px 1fr 52px 56px; align-items: center; gap: 12px; padding: 7px 0;
  .fn-k { font-size: 13px; font-weight: 700; } .fn-bar { height: 14px; border-radius: 7px; background: var(--nw-card2); overflow: hidden; i { display: block; height: 100%; border-radius: 7px; transition: width .5s ease; } }
  b { font-size: 16px; font-weight: 800; text-align: right; } .fn-p { font-size: 12px; font-weight: 700; color: var(--nw-muted); text-align: right; } }
.lg { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: var(--nw-muted); i { width: 9px; height: 9px; border-radius: 2px; margin-left: 6px; } }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 180px; }
.col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px;
  .stk { position: relative; width: 100%; max-width: 26px; height: calc(100% - 18px); display: flex; align-items: flex-end; }
  .stk i { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 4px 4px 0 0; }
  .v { background: #c9d6ea; } .e { background: #387ed1; left: 18% !important; right: 18% !important; } .w { background: #16a085; left: 34% !important; right: 34% !important; }
  small { font-size: 10px; font-weight: 700; color: var(--nw-muted); white-space: nowrap; } }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.li { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; font-weight: 600; border-top: 1px solid var(--nw-border); &:first-of-type { border-top: 0; } b { font-weight: 800; } span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.none { margin: 0; font-size: 12.5px; color: var(--nw-muted); font-weight: 600; }
.pos { color: var(--nw-pos); }
.banner.err { padding: 11px 14px; border-radius: 10px; background: #fdeeee; color: var(--nw-neg); font-weight: 600; }
.btn { border: 1px solid var(--nw-border); background: #fff; border-radius: 8px; padding: 5px 10px; font: inherit; font-weight: 700; cursor: pointer; }
.sk i { display: block; height: 82px; border-radius: 16px; margin-bottom: 12px; background: linear-gradient(90deg, var(--nw-card2), #fff, var(--nw-card2)); background-size: 200% 100%; animation: sk 1.3s linear infinite; &.t { height: 260px; } }
@keyframes sk { to { background-position: -200% 0; } }
@media (max-width: 900px) { .sm { padding: 14px 12px calc(28px + var(--tabbar-h, 0px)); } .land-head h1 { font-size: 22px; } }
@media (max-width: 640px) { .two { grid-template-columns: 1fr; } .kb { flex: 1 1 100%; } .fn-row { grid-template-columns: 100px 1fr 40px 48px; gap: 8px; } }
`],
})
export class SiteMetricsComponent implements OnInit {
  private api = inject(AdminService);
  readonly RANGES = [{ k: 7, l: '7D' }, { k: 30, l: '30D' }, { k: 90, l: '90D' }];
  readonly days = signal(30);
  readonly d = signal<SiteMetrics | null>(null);
  readonly err = signal(false);
  ngOnInit(): void { this.load(); }
  setDays(n: number): void { this.days.set(n); this.load(); }
  load(): void {
    this.err.set(false);
    this.api.siteMetrics(this.days()).subscribe({ next: (m) => this.d.set(m), error: () => this.err.set(true) });
  }
  readonly steps = computed(() => {
    const m = this.d(); if (!m) return [];
    const base = Math.max(1, m.visitors);
    const pc = (n: number) => m.visitors ? Math.round(n / m.visitors * 1000) / 10 + '%' : '—';
    return [
      { k: 'Saw the site', n: m.visitors, w: m.visitors ? 100 : 0, p: m.visitors ? '100%' : '—', c: '#c9d6ea' },
      { k: 'Opened Explore', n: m.people.explore, w: m.people.explore / base * 100, p: pc(m.people.explore), c: '#387ed1' },
      { k: 'Tapped WhatsApp', n: m.people.whatsapp, w: m.people.whatsapp / base * 100, p: pc(m.people.whatsapp), c: '#16a085' },
    ];
  });
  readonly bars = computed(() => {
    const m = this.d(); if (!m) return [];
    const max = Math.max(1, ...m.series.map((s) => s.view));
    const every = m.series.length > 31 ? 14 : m.series.length > 8 ? 5 : 1;
    return m.series.map((s, i) => ({ ...s, hv: s.view / max * 100, he: s.explore / max * 100, hw: s.whatsapp / max * 100,
      lbl: (m.series.length - 1 - i) % every === 0 ? this.day(s.day) : '' }));
  });
  day(iso: string): string { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
}
