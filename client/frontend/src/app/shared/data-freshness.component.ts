import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

import { EstateService, LiveHouse } from '../estate.service';

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
          <button type="button" class="lv-card" *ngFor="let h of houses(); let i = index" [style.--i]="i" (click)="openHouse.set(h)">
            <!-- the same tile the estate board paints for this house -->
            <span class="lv-tile" aria-hidden="true">
              <svg viewBox="0 0 240 170"><use [attr.href]="tileHref(h)" x="0" y="14"/></svg>
            </span>
            <span class="lv-body">
              <span class="lv-top">
                <b class="lv-hn">{{ houseName(h) }}</b>
                <b class="lv-hv">{{ inr(h.value) }}</b>
              </span>
              <span class="lv-bot">
                <!-- where this house sits on the 3x3 board -->
                <span class="lv-map" aria-hidden="true">
                  <i *ngFor="let c of GRID" [class.on]="c === cellOf(h)"></i>
                </span>
                <small class="lv-pos">{{ posLabel(h) }}</small>
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
      position: fixed; z-index: 61; left: 0; right: 0; bottom: 0;
      width: min(100%, 480px); margin-inline: auto;
      max-height: min(86vh, 720px); overflow-y: auto; -webkit-overflow-scrolling: touch;
      display: flex; flex-direction: column; gap: 14px;
      padding: 8px 18px calc(22px + env(safe-area-inset-bottom));
      background: #0B0E13; border: 1px solid #23283340; border-bottom: 0;
      border-radius: 26px 26px 0 0; box-shadow: 0 -24px 60px -20px rgba(0,0,0,.85);
      animation: lv-up .42s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes lv-up { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }
    .lv-grab { align-self: center; width: 40px; height: 4px; border: 0; padding: 0; margin: 4px 0 2px; border-radius: 99px; background: #2A323E; cursor: pointer; }

    /* header */
    .lv-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .lv-id { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .lv-back { width: 32px; height: 32px; flex: none; border-radius: 50%; border: 1px solid #2A323E; background: transparent; color: var(--ink, #EEF1F5); display: grid; place-items: center; cursor: pointer; transition: background .2s; }
    .lv-back:active { background: #171C25; }
    .lv-k { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted, #8B95A3); }
    .lv-v { font-size: 30px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; color: var(--ink, #EEF1F5); font-variant-numeric: tabular-nums; }
    .lv-date { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; background: rgba(100,195,125,.12); color: #7fd398; font-size: 11px; font-weight: 700; white-space: nowrap; flex: none; }
    .lv-date i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: lv-pulse 2.4s ease-in-out infinite; }
    @keyframes lv-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

    /* rows */
    .lv-list { display: grid; gap: 1px; border-radius: 16px; overflow: hidden; background: #242a36; }
    .lv-row {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      padding: 13px 14px; background: #151922; border: 0; font: inherit; color: inherit;
      animation: lv-in .4s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i) * 45ms);
    }
    .lv-row.tap { cursor: pointer; transition: background .2s; }
    .lv-row.tap:active { background: #1b2130; }
    @keyframes lv-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .lv-ico { width: 34px; height: 34px; flex: none; border-radius: 10px; display: grid; place-items: center; background: rgba(139,123,240,.14); color: var(--brass, #8B7BF0); }
    .lv-ico svg { width: 19px; height: 19px; }
    .lv-ico.build { background: rgba(233,193,92,.14); color: #E9C15C; }
    .lv-name { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .lv-name.wide { flex: 1; }
    .lv-name b { font-size: 13.5px; font-weight: 650; color: var(--ink, #EEF1F5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-name small { font-size: 11px; color: var(--muted, #8B95A3); font-variant-numeric: tabular-nums; }
    .lv-amt { text-align: right; display: grid; gap: 2px; flex: none; }
    .lv-amt b { font-size: 14px; font-weight: 700; color: var(--ink, #EEF1F5); font-variant-numeric: tabular-nums; }
    .lv-amt small { font-size: 11px; font-variant-numeric: tabular-nums; }
    .lv-amt .pos { color: #8fd65a; } .lv-amt .neg { color: #d98a8a; }
    .lv-chev { flex: none; color: #4b5261; }
    /* ── house cards ── */
    .lv-cards { display: grid; gap: 10px; }
    .lv-card {
      display: grid; grid-template-columns: 92px 1fr auto; align-items: center; gap: 14px;
      width: 100%; text-align: left; padding: 12px 14px 12px 10px;
      background: #151922; border: 1px solid #232a36; border-radius: 18px;
      font: inherit; color: inherit; cursor: pointer;
      transition: background .2s, border-color .2s, transform .3s cubic-bezier(.22,1,.36,1);
      animation: lv-in .45s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i) * 60ms);
    }
    .lv-card:active { transform: scale(.99); background: #1b2130; }
    .lv-tile { display: block; width: 92px; }
    .lv-tile svg { width: 100%; height: auto; display: block; filter: drop-shadow(0 8px 12px rgba(0,0,0,.5)); }
    .lv-body { display: grid; gap: 6px; min-width: 0; }
    .lv-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .lv-hn { font-size: 14.5px; font-weight: 700; color: var(--ink, #EEF1F5); }
    .lv-hv { font-size: 16px; font-weight: 800; letter-spacing: -.02em; color: var(--ink, #EEF1F5); font-variant-numeric: tabular-nums; }
    .lv-bot { display: flex; align-items: center; gap: 8px; }
    .lv-map { display: grid; grid-template-columns: repeat(3, 6px); gap: 3px; flex: none; padding: 1px; }
    .lv-map i { width: 6px; height: 6px; border-radius: 2px; background: #333c4c; }
    .lv-map i.on { background: #a99bff; box-shadow: 0 0 0 2.5px rgba(139,123,240,.28); }
    .lv-pos { font-size: 11px; color: var(--muted, #8B95A3); white-space: nowrap; }
    .lv-gain { margin-left: auto; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .lv-gain.pos { color: #8fd65a; } .lv-gain.neg { color: #d98a8a; }
    .lv-prog { display: flex; align-items: center; gap: 8px; }
    .lv-track { flex: 1; height: 4px; border-radius: 99px; background: #2a3140; overflow: hidden; min-width: 0; }
    .lv-track i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #E9C15C, #f6d98a); }
    .lv-prog small { font-size: 10.5px; font-weight: 600; color: #E9C15C; white-space: nowrap; flex: none; }
    .lv-card .lv-chev { color: #4b5261; }

    .lv-empty { margin: 0; padding: 16px; background: #151922; font-size: 12px; color: var(--muted, #8B95A3); text-align: center; }
    .lv-sk { display: grid; gap: 1px; }
    .lv-sk { gap: 10px; }
    .lv-sk i { display: block; height: 92px; border-radius: 18px; background: linear-gradient(100deg, #151922 30%, #202632 50%, #151922 70%); background-size: 200% 100%; animation: lv-shim 1.3s linear infinite; }
    @keyframes lv-shim { to { background-position: -200% 0; } }

    .lv-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 13px; border-radius: 14px; border: 0; cursor: pointer;
      background: linear-gradient(120deg, #8b7bf0, #6f5ce6); color: #fff; font-size: 13.5px; font-weight: 700;
      transition: transform .3s cubic-bezier(.22,1,.36,1), filter .2s;
    }
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
    DataFreshnessComponent.loadTiles();
  }

  /** The board tile symbols live in a static sprite; inject it once per page so
   *  every <use href="#lvVilla"> in this (body-hosted) sheet resolves. */
  private static tilesLoaded = false;
  private static loadTiles(): void {
    if (DataFreshnessComponent.tilesLoaded || typeof document === 'undefined') return;
    DataFreshnessComponent.tilesLoaded = true;
    fetch('assets/house-tiles.svg').then((r) => r.text()).then((svg) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = svg;
      document.body.appendChild(host);
    }).catch(() => {});
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

  @HostListener('document:keydown.escape') onEsc(): void {
    if (this.openHouse()) this.closeHouse(); else this.close();
  }

  private load(): void {
    this.loading.set(true);
    this.est.liveHouses().subscribe({
      next: (r) => {
        this.houses.set(r.houses || []);
        this.loading.set(false);
        // keep the opened house in sync after a refresh
        const cur = this.openHouse();
        if (cur) this.openHouse.set((r.houses || []).find((h) => h.id === cur.id) ?? null);
      },
      error: () => { this.loading.set(false); },
    });
  }

  refresh(): void {
    if (navigator.vibrate) navigator.vibrate(4);
    this.est.refreshNow();
    this.load();
  }

  /** Board fill order — the same one estate-home paints: centre, then outward. */
  private static readonly ORDER: [number, number][] = [
    [1, 1], [2, 2], [1, 2], [2, 1], [0, 2], [2, 0], [0, 1], [1, 0], [0, 0],
  ];
  /** 0..8 in reading order, so the mini-map renders row by row. */
  readonly GRID = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  readonly Math = Math;

  /** Which board symbol paints this house (finished villa, or its build stage). */
  tileHref(h: LiveHouse): string {
    if (!h.building) return '#lvVilla';
    const stage = Math.min(4, Math.floor((h.pct / 100) * 5));
    return ['#lvGround', '#lvLand', '#lvGrade', '#lvFound', '#lvSteel'][stage];
  }

  /** The 0..8 reading-order cell this house occupies on the board. */
  cellOf(h: LiveHouse): number {
    const rc = DataFreshnessComponent.ORDER[h.index];
    return rc ? rc[0] * 3 + rc[1] : -1;
  }

  /** "Row 2 · centre" — where this house sits on the 3×3 board. */
  posLabel(h: LiveHouse): string {
    const rc = DataFreshnessComponent.ORDER[h.index];
    if (!rc) return '';
    const [r, c] = rc;
    const col = ['left', 'centre', 'right'][c];
    return `Row ${r + 1} · ${col}`;
  }

  houseName(h: LiveHouse): string { return 'House ' + (h.index + 1); }
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
