import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

import { EstateService, LiveHouse } from '../estate.service';
import { loadTileSprite } from './tile-sprite';

/**
 * LIVE VALUES SHEET — opened by tapping the portfolio value.
 *
 * Two levels, no clutter:
 *   1. HOUSES — what each house in the estate is worth right now.
 *   2. Tap a house → the funds inside it: units × NAV = value.
 *
 * The only chrome is the NAV date, the value, and Refresh.
 */
@Component({
  selector: 'app-data-freshness',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="open()">
      <div class="lv-backdrop" (click)="close()" aria-hidden="true"></div>
      <div class="lv" role="dialog" aria-label="Live values">
        <button type="button" class="lv-grab" (click)="close()" aria-label="Close"></button>

        <!-- ── header: at the house level it's the portfolio; inside a house it's that house ── -->
        <header class="lv-head">
          <div class="lv-id">
            <button type="button" class="lv-back" *ngIf="openHouse() as h" (click)="closeHouse()" aria-label="Back to houses">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div>
              <span class="lv-k">{{ openHouse() ? houseName(openHouse()!) : 'Portfolio value' }}</span>
              <div class="lv-v">{{ inr(openHouse() ? openHouse()!.value : worth()) }}</div>
            </div>
          </div>
          <span class="lv-date"><i></i>{{ navDate() ? (navDate() | date:'d MMM') : '—' }}</span>
        </header>

        <!-- ── level 1: houses ── -->
        <div class="lv-cards" *ngIf="!openHouse()">
          <div class="lv-sk" *ngIf="loading()"><i></i><i></i></div>
          <button type="button" class="lv-card" *ngFor="let h of houses(); let i = index; trackBy: trackHouse" [style.--i]="i" (click)="openHouse.set(h)">
            <!-- the same tile the estate board paints for this house -->
            <span class="lv-tile" aria-hidden="true">
              <svg viewBox="0 0 240 170"><use [attr.href]="tileHref(h)" x="0" y="14"/></svg>
            </span>
            <span class="lv-body">
              <span class="lv-top">
                <span class="lv-title">
                  <b class="lv-hn">{{ houseName(h) }}</b>
                  <small class="lv-badge" [class.build]="h.building">{{ statusWord(h) }}</small>
                </span>
                <b class="lv-hv">{{ inr(h.value) }}</b>
              </span>
              <span class="lv-bot">
                <!-- where this house sits on the 3x3 board (the diagram is enough) -->
                <span class="lv-map" aria-hidden="true">
                  <i *ngFor="let c of GRID" [class.on]="c === cellOf(h)"></i>
                </span>
                <small class="lv-gain" [class.pos]="h.gain >= 0" [class.neg]="h.gain < 0">{{ h.gain >= 0 ? '+' : '' }}{{ inr(h.gain) }}</small>
              </span>
              <span class="lv-prog" *ngIf="h.building">
                <span class="lv-track"><i [style.width.%]="Math.max(3, h.pct)"></i></span>
                <small>{{ h.pct | number:'1.0-0' }}% built</small>
              </span>
            </span>
            <svg class="lv-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <p class="lv-empty" *ngIf="!loading() && !houses().length">No houses yet.</p>
        </div>

        <!-- ── level 2: the funds inside one house ── -->
        <div class="lv-list" *ngIf="openHouse() as h">
          <div class="lv-row" *ngFor="let f of h.funds; let i = index" [style.--i]="i">
            <span class="lv-name wide">
              <b>{{ shortName(f.name) }}</b>
              <small>{{ f.units | number:'1.0-3' }} × ₹{{ f.nav | number:'1.2-4' }}</small>
            </span>
            <span class="lv-amt">
              <b>{{ inr(f.value) }}</b>
              <small [class.pos]="f.gain >= 0" [class.neg]="f.gain < 0">{{ f.gain >= 0 ? '+' : '' }}{{ inr(f.gain) }}</small>
            </span>
          </div>
        </div>

        <button type="button" class="lv-btn" (click)="refresh()" [disabled]="est.refreshing()">
          <span class="lv-spin" *ngIf="est.refreshing(); else refIcon"></span>
          <ng-template #refIcon><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 6.5V11h-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></ng-template>
          {{ est.refreshing() ? 'Refreshing…' : 'Refresh now' }}
        </button>
      </div>
    </ng-container>
  `,
  styles: [`
    :host { display: contents; }
    :host(.lv-hosted) { display: block; position: fixed; inset: 0; z-index: 60; pointer-events: none; }
    :host(.lv-hosted.lv-shut) { display: none; }
    :host(.lv-hosted) .lv-backdrop, :host(.lv-hosted) .lv { pointer-events: auto; }

    .lv-backdrop {
      position: fixed; inset: 0; z-index: 60; background: rgba(6, 8, 12, 0.66);
      backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
      animation: lv-fade .26s ease both;
    }
    @keyframes lv-fade { from { opacity: 0; } to { opacity: 1; } }

    .lv {
      /* one cohesive palette, defined once and reused everywhere below */
      --lv-bg: #0d1117;          /* sheet ground */
      --lv-surface: #161c26;     /* cards / rows */
      --lv-surface-2: #1c2431;   /* pressed / tracks */
      --lv-line: #262f3d;        /* hairline borders */
      --lv-ink: #f2f5f9;         /* primary text */
      --lv-ink-2: #9aa6b6;       /* secondary text */
      --lv-chev: #4d5666;        /* chevrons */
      --lv-accent: #7c8cff;      /* villa / primary accent */
      --lv-accent-soft: rgba(124,140,255,.16);
      --lv-build: #f0b843;       /* under-construction accent (warm amber) */
      --lv-build-soft: rgba(240,184,67,.15);
      --lv-pos: #56d17f;         /* gains */
      --lv-neg: #ff8a8a;         /* losses */

      position: fixed; z-index: 61; left: 0; right: 0; bottom: 0;
      width: min(100%, 480px); margin-inline: auto;
      max-height: min(86vh, 720px); overflow-y: auto; -webkit-overflow-scrolling: touch;
      display: flex; flex-direction: column; gap: 14px;
      padding: 8px 18px calc(22px + env(safe-area-inset-bottom));
      background: var(--lv-bg); border: 1px solid var(--lv-line); border-bottom: 0;
      border-radius: 26px 26px 0 0; box-shadow: 0 -24px 70px -20px rgba(0,0,0,.9);
      animation: lv-up .42s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes lv-up { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }
    .lv-grab { align-self: center; width: 40px; height: 4px; border: 0; padding: 0; margin: 4px 0 2px; border-radius: 99px; background: var(--lv-line); cursor: pointer; }

    /* header */
    .lv-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .lv-id { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .lv-back { width: 32px; height: 32px; flex: none; border-radius: 50%; border: 1px solid var(--lv-line); background: transparent; color: var(--lv-ink); display: grid; place-items: center; cursor: pointer; transition: background .2s; }
    .lv-back:active { background: var(--lv-surface-2); }
    .lv-k { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--lv-ink-2); }
    .lv-v { font-size: 30px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; color: var(--lv-ink); font-variant-numeric: tabular-nums; }
    .lv-date { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 99px; background: rgba(86,209,127,.12); color: var(--lv-pos); font-size: 11px; font-weight: 700; white-space: nowrap; flex: none; }
    .lv-date i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: lv-pulse 2.4s ease-in-out infinite; }
    @keyframes lv-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

    /* rows (funds inside a house) */
    .lv-list { display: grid; gap: 1px; border-radius: 16px; overflow: hidden; border: 1px solid var(--lv-line); background: var(--lv-line); }
    .lv-row {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      padding: 13px 14px; background: var(--lv-surface); border: 0; font: inherit; color: inherit;
      animation: lv-in .4s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i) * 45ms);
    }
    @keyframes lv-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .lv-name { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .lv-name.wide { flex: 1; }
    .lv-name b { font-size: 13.5px; font-weight: 650; color: var(--lv-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-name small { font-size: 11px; color: var(--lv-ink-2); font-variant-numeric: tabular-nums; }
    .lv-amt { text-align: right; display: grid; gap: 2px; flex: none; }
    .lv-amt b { font-size: 14px; font-weight: 700; color: var(--lv-ink); font-variant-numeric: tabular-nums; }
    .lv-amt small { font-size: 11px; font-variant-numeric: tabular-nums; }
    .lv-amt .pos { color: var(--lv-pos); } .lv-amt .neg { color: var(--lv-neg); }
    .lv-chev { flex: none; color: var(--lv-chev); }

    /* ── house cards ── */
    .lv-cards { display: grid; gap: 10px; }
    .lv-card {
      display: grid; grid-template-columns: 88px 1fr auto; align-items: center; gap: 12px;
      width: 100%; text-align: left; padding: 12px 14px 12px 8px;
      background: var(--lv-surface); border: 1px solid var(--lv-line); border-radius: 18px;
      font: inherit; color: inherit; cursor: pointer;
      transition: background .2s, border-color .2s, transform .3s cubic-bezier(.22,1,.36,1);
      animation: lv-in .45s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i) * 60ms);
    }
    .lv-card:hover { border-color: color-mix(in srgb, var(--lv-accent) 45%, var(--lv-line)); }
    .lv-card:active { transform: scale(.99); background: var(--lv-surface-2); }
    .lv-tile { display: block; width: 88px; }
    .lv-tile svg { width: 100%; height: auto; display: block; filter: drop-shadow(0 8px 14px rgba(0,0,0,.55)); }
    .lv-body { display: grid; gap: 7px; min-width: 0; }
    .lv-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .lv-title { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .lv-hn { font-size: 14.5px; font-weight: 700; color: var(--lv-ink); white-space: nowrap; }
    /* status chip: villa = accent, building = amber */
    .lv-badge {
      font-size: 8.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 99px; flex: none;
      color: var(--lv-accent); background: var(--lv-accent-soft);
    }
    .lv-badge.build { color: var(--lv-build); background: var(--lv-build-soft); }
    .lv-hv { font-size: 16px; font-weight: 800; letter-spacing: -.02em; color: var(--lv-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .lv-bot { display: flex; align-items: center; gap: 12px; }
    /* the 3x3 position diagram — every cell clearly visible, the occupied one
       lit up so "where on the estate" reads at a glance */
    .lv-map { display: grid; grid-template-columns: repeat(3, 9px); gap: 4px; flex: none; padding: 2px; }
    .lv-map i {
      width: 9px; height: 9px; border-radius: 3px;
      background: #37414f; border: 1px solid #454f5f;   /* empty parcels: dim but clearly there */
    }
    .lv-map i.on {
      background: var(--lv-accent); border-color: var(--lv-accent);
      box-shadow: 0 0 0 3px var(--lv-accent-soft), 0 0 8px 1px color-mix(in srgb, var(--lv-accent) 55%, transparent);
    }
    .lv-gain { margin-left: auto; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .lv-gain.pos { color: var(--lv-pos); } .lv-gain.neg { color: var(--lv-neg); }
    .lv-prog { display: flex; align-items: center; gap: 8px; }
    .lv-track { flex: 1; height: 4px; border-radius: 99px; background: var(--lv-surface-2); overflow: hidden; min-width: 0; }
    .lv-track i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--lv-build), #f7d488); }
    .lv-prog small { font-size: 10.5px; font-weight: 700; color: var(--lv-build); white-space: nowrap; flex: none; }
    .lv-card .lv-chev { color: var(--lv-chev); }

    .lv-empty { margin: 0; padding: 16px; border-radius: 16px; background: var(--lv-surface); border: 1px solid var(--lv-line); font-size: 12px; color: var(--lv-ink-2); text-align: center; }
    .lv-sk { display: grid; gap: 10px; }
    .lv-sk i { display: block; height: 90px; border-radius: 18px; background: linear-gradient(100deg, var(--lv-surface) 30%, var(--lv-surface-2) 50%, var(--lv-surface) 70%); background-size: 200% 100%; animation: lv-shim 1.3s linear infinite; }
    @keyframes lv-shim { to { background-position: -200% 0; } }

    .lv-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 14px; border-radius: 14px; border: 0; cursor: pointer;
      background: linear-gradient(120deg, #8091ff, #6a78f0); color: #fff; font-size: 13.5px; font-weight: 700;
      box-shadow: 0 12px 26px -14px rgba(124,140,255,.8);
      transition: transform .3s cubic-bezier(.22,1,.36,1), filter .2s;
    }
    .lv-btn:hover:not(:disabled) { filter: brightness(1.06); }
    .lv-btn:active { transform: scale(.985); }
    .lv-btn:disabled { opacity: .72; cursor: default; }
    .lv-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: lv-spin .8s linear infinite; }
    @keyframes lv-spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .lv, .lv-backdrop, .lv-row, .lv-date i, .lv-sk i { animation: none !important; }
    }
  `],
})
export class DataFreshnessComponent implements OnInit, OnDestroy {
  est = inject(EstateService);

  open = signal(false);
  houses = signal<LiveHouse[]>([]);
  openHouse = signal<LiveHouse | null>(null);
  loading = signal(false);

  private now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;

  navDate = computed(() => this.est.portfolio()?.nav_date ?? null);
  worth = computed(() => this.est.estateValue);

  ngOnInit(): void {
    this.timer = setInterval(() => this.now.set(Date.now()), 30000);
    loadTileSprite();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    document.body.classList.remove('lv-sheet-open');
  }

  private host = inject(ElementRef<HTMLElement>);

  /** Called by the host screen when the user taps the ₹ figure. */
  show(): void {
    this.open.set(true);
    this.openHouse.set(null);
    document.body.classList.add('lv-sheet-open');
    queueMicrotask(() => {
      const el = this.host.nativeElement as HTMLElement;
      el.classList.remove('lv-shut');
      if (el.parentElement !== document.body) { el.classList.add('lv-hosted'); document.body.appendChild(el); }
    });
    if (navigator.vibrate) navigator.vibrate(4);
    this.load();
  }
  close(): void {
    this.open.set(false); this.openHouse.set(null);
    document.body.classList.remove('lv-sheet-open');
    (this.host.nativeElement as HTMLElement).classList.add('lv-shut');
  }
  closeHouse(): void { this.openHouse.set(null); if (navigator.vibrate) navigator.vibrate(3); }

  /** Stable identity for *ngFor, so a refresh reuses each card's DOM node
   *  instead of destroying + recreating it (which replays the entrance anim). */
  trackHouse = (_: number, h: LiveHouse) => h.id;

  /** True when two house lists are materially identical (same ids, values, gains
   *  and build %), so a refresh that returns the same numbers doesn't trigger a
   *  needless re-render/animation. */
  private sameHouses(a: LiveHouse[], b: LiveHouse[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.id !== y.id || x.value !== y.value || x.gain !== y.gain ||
          x.pct !== y.pct || x.building !== y.building) return false;
    }
    return true;
  }

  @HostListener('document:keydown.escape') onEsc(): void {
    if (this.openHouse()) this.closeHouse(); else this.close();
  }

  private load(): void {
    // Show cached houses INSTANTLY (warmed during the splash), so the sheet is
    // populated the moment it opens — the network fetch below only refreshes it.
    const cached = this.est.housesCache();
    if (cached) this.houses.set(cached);
    // The cache is refreshed with every portfolio reload (open, foreground,
    // Refresh now). Showing it and then quietly swapping in a re-fetch could
    // change a number under the user's eyes — so a warm cache is final here.
    if (cached && cached.length && !this.force) { this.loading.set(false); return; }
    // Only show the skeleton when we have genuinely nothing to show yet.
    this.loading.set(!cached || cached.length === 0);
    this.est.liveHouses().subscribe({
      next: (r) => {
        const fresh = r.houses || [];
        this.loading.set(false);
        // Avoid a second "entrance" flash: if the fresh data is materially the
        // same as what we already showed from cache, DON'T replace the array —
        // that would re-run the staggered card animation (the double-blink). We
        // only re-set when something actually changed. `trackBy` on the id keeps
        // the DOM stable across a real update too, so values morph in place.
        if (!this.sameHouses(this.houses(), fresh)) this.houses.set(fresh);
        // keep the opened house in sync after a refresh
        const cur = this.openHouse();
        if (cur) this.openHouse.set(fresh.find((h) => h.id === cur.id) ?? null);
      },
      error: () => { this.loading.set(false); },
    });
  }

  /** True only for an explicit Refresh — the one time a re-fetch is wanted. */
  private force = false;
  refresh(): void {
    if (navigator.vibrate) navigator.vibrate(4);
    this.est.refreshNow();
    this.force = true;
    try { this.load(); } finally { this.force = false; }
  }

  /** Board fill order — the same one estate-home paints: centre, then outward. */
  private static readonly ORDER: [number, number][] = [
    [1, 1], [2, 2], [1, 2], [2, 1], [0, 2], [2, 0], [0, 1], [1, 0], [0, 0],
  ];
  /** 0..8 in reading order, so the mini-map renders row by row. */
  readonly GRID = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  readonly Math = Math;

  /** The 0-based build stage of a house-in-progress (0 plot … 3 steel), from its
   *  funded %. A finished villa is stage 5; -1 means "not building". */
  private stageOf(h: LiveHouse): number {
    if (!h.building) return 5;
    // 5 stages of a build map onto 0..100%: Plot / Levelled / Foundation / Steel.
    return Math.min(3, Math.floor((h.pct / 100) * 4));
  }

  /** Which board symbol paints this house (finished villa, or its build stage). */
  tileHref(h: LiveHouse): string {
    if (!h.building) return '#lvVilla';
    // 0 Plot → land, 1 Levelled → grade, 2 Foundation → found, 3 Steel → steel.
    return ['#lvLand', '#lvGrade', '#lvFound', '#lvSteel'][this.stageOf(h)] || '#lvLand';
  }

  /** The 0..8 reading-order cell this house occupies on the board. */
  cellOf(h: LiveHouse): number {
    const rc = DataFreshnessComponent.ORDER[h.index];
    return rc ? rc[0] * 3 + rc[1] : -1;
  }

  /** Stage names for a build in progress, matching the estate board reference. */
  private static readonly STAGE = ['Plot', 'Levelled Ground', 'Foundation', 'Steel Frame'];

  /** The card title: a finished home is "Villa N"; one under construction reads
   *  as its real stage ("Plot", "Foundation", …) — never a bare "House N". */
  houseName(h: LiveHouse): string {
    if (!h.building) return 'Villa ' + (h.index + 1);
    return DataFreshnessComponent.STAGE[this.stageOf(h)] || 'Plot';
  }

  /** A short one-word status chip: FINISHED for a villa, BUILDING otherwise. */
  statusWord(h: LiveHouse): string { return h.building ? 'Building' : 'Villa'; }
  inr(n: number): string {
    const v = Math.round(n || 0);
    return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN');
  }
  shortName(n: string): string {
    return (n || '')
      .replace(/\s*[-–]\s*(Regular|Direct)\s*Plan\s*/i, ' ')
      .replace(/\s*[-–]?\s*(Growth|Gr)\.?$/i, '')
      .trim();
  }
}
