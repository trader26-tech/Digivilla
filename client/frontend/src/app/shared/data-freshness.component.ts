import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

import { EstateService, LiveNav } from '../estate.service';

/**
 * LIVE VALUES SHEET — opened by tapping the portfolio value itself.
 *
 * Nothing of this sits on the home screen. The only always-visible affordance is
 * a 5px dot the host screen draws beside its own label; everything else lives in
 * a bottom sheet the user pulls up deliberately:
 *
 *   • the value, and the exact NAV date it is built from
 *   • every held fund: units × live NAV = value
 *   • when the app last reloaded, when the next NAV lands, and WHY that time
 *   • Refresh now
 *
 * The NAVs come from AMFI's own published file (see backend nav_cache), so the
 * numbers match any other platform reading the same source.
 */
@Component({
  selector: 'app-data-freshness',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- no chrome on the page: the host screen makes its own ₹ figure the trigger.
         The sheet itself is moved to <body> on open (see show()), so no ancestor
         stacking context on the host screen can paint over it. -->
    <ng-container *ngIf="open()">
      <div class="lv-backdrop" (click)="close()" aria-hidden="true"></div>
      <div class="lv" role="dialog" aria-label="Live values">
        <button type="button" class="lv-grab" (click)="close()" aria-label="Close"></button>

        <header class="lv-head">
          <div>
            <span class="lv-k">Portfolio value</span>
            <div class="lv-v">{{ inr(worth()) }}</div>
          </div>
          <span class="lv-date" [class.stale]="stale()">
            <i></i>{{ navDate() ? (navDate() | date:'d MMM') : '—' }} NAV
          </span>
        </header>

        <p class="lv-sub">Units you hold × each fund’s latest published NAV. Taken from AMFI, the same file every platform reads.</p>

        <div class="lv-list">
          <div class="lv-sk" *ngIf="navsLoading()"><i></i><i></i><i></i></div>
          <div class="lv-row" *ngFor="let f of navs(); let i = index" [style.--i]="i">
            <div class="lv-name">
              <b>{{ shortName(f.name) }}</b>
              <span>{{ f.units | number:'1.0-3' }} × ₹{{ f.nav | number:'1.2-4' }}</span>
            </div>
            <div class="lv-amt">
              <b>{{ inr(f.value) }}</b>
              <span [class.pos]="f.gain >= 0" [class.neg]="f.gain < 0">{{ f.gain >= 0 ? '+' : '' }}{{ inr(f.gain) }}</span>
            </div>
          </div>
          <p class="lv-empty" *ngIf="!navsLoading() && !navs().length">No funds mapped yet.</p>
        </div>

        <div class="lv-meta">
          <div class="lv-m">
            <span class="lv-mk">Loaded</span>
            <b>{{ est.lastLoadedAt() ? (est.lastLoadedAt() | date:'h:mm a') : '—' }}<small *ngIf="est.lastLoadedAt() as t"> · {{ ago(t) }}</small></b>
          </div>
          <div class="lv-m">
            <span class="lv-mk">Next NAV</span>
            <b *ngIf="nextRefresh() as n; else nonext">{{ nextLabel(n) }}<small> · {{ countdown(n) }}</small></b>
            <ng-template #nonext><b>—</b></ng-template>
          </div>
        </div>

        <button type="button" class="lv-why" (click)="why.set(!why())" [attr.aria-expanded]="why()">
          Why 1:00 AM?
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <p class="lv-note" *ngIf="why()">
          Funds aren’t priced through the day. Each house strikes one NAV after the market closes and files it with AMFI between <b>9 PM and midnight</b>. We read the published file at <b>1:00 AM</b>, once every fund has filed, so your value updates completely rather than fund by fund. Tapping Refresh checks AMFI again right away.
        </p>

        <button type="button" class="lv-btn" (click)="refresh()" [disabled]="est.refreshing()">
          <span class="lv-spin" *ngIf="est.refreshing(); else refIcon"></span>
          <ng-template #refIcon><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 6.5V11h-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></ng-template>
          {{ est.refreshing() ? 'Checking AMFI…' : 'Refresh now' }}
        </button>
      </div>
    </ng-container>
  `,
  styles: [`
    :host { display: contents; }
    /* once moved to <body> the host is a positioned layer above all screen chrome */
    :host(.lv-hosted) { display: block; position: fixed; inset: 0; z-index: 60; pointer-events: none; }
    :host(.lv-hosted.lv-shut) { display: none; }
    :host(.lv-hosted) .lv-backdrop, :host(.lv-hosted) .lv { pointer-events: auto; }

    .lv-backdrop {
      position: fixed; inset: 0; z-index: 60; background: rgba(6, 8, 12, 0.62);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: lv-fade .26s ease both;
    }
    @keyframes lv-fade { from { opacity: 0; } to { opacity: 1; } }

    .lv {
      position: fixed; z-index: 61; left: 0; right: 0; bottom: 0;
      width: min(100%, 480px); margin-inline: auto;
      max-height: min(86vh, 720px); overflow-y: auto; -webkit-overflow-scrolling: touch;
      display: flex; flex-direction: column; gap: 10px;
      padding: 8px 18px calc(22px + env(safe-area-inset-bottom));
      background: #0B0E13; border: 1px solid var(--survey, #2A323E); border-bottom: 0;
      border-radius: 26px 26px 0 0; box-shadow: 0 -24px 60px -20px rgba(0,0,0,.85);
      animation: lv-up .42s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes lv-up { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }

    .lv-grab { align-self: center; width: 40px; height: 4px; border: 0; padding: 0; margin: 4px 0 6px; border-radius: 99px; background: var(--survey, #2A323E); cursor: pointer; }

    .lv-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .lv-k { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted, #8B95A3); }
    .lv-v { font-size: 30px; font-weight: 800; letter-spacing: -.03em; line-height: 1.1; color: var(--ink, #EEF1F5); font-variant-numeric: tabular-nums; }
    .lv-date { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 99px; background: rgba(100,195,125,.12); color: #7fd398; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .lv-date i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: lv-pulse 2.4s ease-in-out infinite; }
    .lv-date.stale { background: rgba(233,193,92,.12); color: #E9C15C; }
    @keyframes lv-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

    .lv-sub { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--muted, #8B95A3); }

    .lv-list { display: grid; gap: 1px; border-radius: 14px; overflow: hidden; background: #242a36; }
    .lv-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 11px 12px; background: #151922;
      animation: lv-in .4s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i) * 45ms);
    }
    @keyframes lv-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .lv-name { display: grid; gap: 2px; min-width: 0; }
    .lv-name b { font-size: 12.5px; font-weight: 650; color: var(--ink, #EEF1F5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-name span { font-size: 11px; color: var(--muted, #8B95A3); font-variant-numeric: tabular-nums; }
    .lv-amt { text-align: right; display: grid; gap: 2px; flex: none; }
    .lv-amt b { font-size: 13px; font-weight: 700; color: var(--ink, #EEF1F5); font-variant-numeric: tabular-nums; }
    .lv-amt span { font-size: 11px; font-variant-numeric: tabular-nums; }
    .lv-amt .pos { color: #8fd65a; } .lv-amt .neg { color: #d98a8a; }
    .lv-empty { margin: 0; padding: 14px; background: #151922; font-size: 12px; color: var(--muted, #8B95A3); text-align: center; }
    .lv-sk { display: grid; gap: 1px; }
    .lv-sk i { display: block; height: 44px; background: linear-gradient(100deg, #151922 30%, #202632 50%, #151922 70%); background-size: 200% 100%; animation: lv-shim 1.3s linear infinite; }
    @keyframes lv-shim { to { background-position: -200% 0; } }

    .lv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .lv-m { padding: 9px 11px; border-radius: 12px; background: #151922; display: grid; gap: 2px; }
    .lv-mk { font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted, #8B95A3); }
    .lv-m b { font-size: 13px; font-weight: 700; color: var(--ink, #EEF1F5); }
    .lv-m small { font-weight: 500; color: var(--muted, #8B95A3); }

    .lv-why { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: var(--brass, #8B7BF0); font-size: 11.5px; font-weight: 650; cursor: pointer; }
    .lv-why svg { transition: transform .3s cubic-bezier(.22,1,.36,1); }
    .lv-why[aria-expanded="true"] svg { transform: rotate(180deg); }
    .lv-note { margin: 0; font-size: 11.5px; line-height: 1.55; color: var(--muted, #8B95A3); animation: lv-in .32s cubic-bezier(.22,1,.36,1) both; }
    .lv-note b { color: var(--ink-2, #c9cbd1); font-weight: 650; }

    .lv-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px; margin-top: 2px;
      padding: 12px; border-radius: 13px; border: 0; cursor: pointer;
      background: linear-gradient(120deg, #8b7bf0, #6f5ce6); color: #fff; font-size: 13px; font-weight: 700;
      transition: transform .3s cubic-bezier(.22,1,.36,1), filter .2s;
    }
    .lv-btn:active { transform: scale(.985); }
    .lv-btn:disabled { opacity: .72; cursor: default; }
    .lv-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: lv-spin .8s linear infinite; }
    @keyframes lv-spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .lv, .lv-backdrop, .lv-row, .lv-note, .lv-date i, .lv-sk i { animation: none !important; }
    }
  `],
})
export class DataFreshnessComponent implements OnInit, OnDestroy {
  est = inject(EstateService);

  open = signal(false);
  why = signal(false);
  navs = signal<LiveNav[]>([]);
  navsLoading = signal(false);

  private now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;

  navDate = computed(() => this.est.portfolio()?.nav_date ?? null);
  nextRefresh = computed(() => this.est.portfolio()?.next_refresh ?? null);
  worth = computed(() => this.est.estateValue);
  /** Amber when the NAV we hold is older than a long weekend — something is off. */
  stale = computed(() => {
    const d = this.navDate();
    if (!d) return false;
    return Math.floor((this.now() - new Date(d + 'T00:00:00').getTime()) / 86400000) > 4;
  });

  ngOnInit(): void { this.timer = setInterval(() => this.now.set(Date.now()), 1000); }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    document.body.classList.remove('lv-sheet-open');
  }

  /** Called by the host screen when the user taps the ₹ figure. */
  private host = inject(ElementRef<HTMLElement>);

  show(): void {
    this.open.set(true);
    document.body.classList.add('lv-sheet-open');   // hides the shell's tab bar
    // Render at the document root so nothing on the host screen can overlap it.
    queueMicrotask(() => {
      const el = this.host.nativeElement as HTMLElement;
      el.classList.remove('lv-shut');
      if (el.parentElement !== document.body) { el.classList.add('lv-hosted'); document.body.appendChild(el); }
    });
    if (navigator.vibrate) navigator.vibrate(4);
    this.loadNavs();
  }
  close(): void {
    this.open.set(false); this.why.set(false);
    document.body.classList.remove('lv-sheet-open');
    // the teleported host must stop covering the screen while shut
    (this.host.nativeElement as HTMLElement).classList.add('lv-shut');
  }

  @HostListener('document:keydown.escape') onEsc(): void { this.close(); }

  private loadNavs(): void {
    this.navsLoading.set(true);
    this.est.liveNavs().subscribe({
      next: (r) => { this.navs.set(r.funds || []); this.navsLoading.set(false); },
      error: () => { this.navsLoading.set(false); },
    });
  }

  refresh(): void {
    if (navigator.vibrate) navigator.vibrate(4);
    this.est.refreshNow();
    this.loadNavs();
  }

  inr(n: number): string { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
  /** "Kotak Arbitrage Fund Growth" → "Kotak Arbitrage Fund". */
  shortName(n: string): string {
    return (n || '')
      .replace(/\s*[-–]\s*(Regular|Direct)\s*Plan\s*/i, ' ')
      .replace(/\s*[-–]?\s*(Growth|Gr)\.?$/i, '')
      .trim();
  }

  ago(t: number): string {
    const s = Math.max(0, Math.round((this.now() - t) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    return h < 48 ? 'yesterday' : `${Math.floor(h / 24)} days ago`;
  }
  nextLabel(iso: string): string {
    const n = new Date(iso), now = new Date(this.now());
    const time = n.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toUpperCase();
    const diff = Math.round((this.startOfDay(n) - this.startOfDay(now)) / 86400000);
    if (diff === 0) return `Today, ${time}`;
    if (diff === 1) return (now.getHours() >= 18 ? 'Tonight' : 'Tomorrow') + `, ${time}`;
    return `${n.toLocaleDateString('en-IN', { weekday: 'short' })}, ${time}`;
  }
  countdown(iso: string): string {
    const ms = new Date(iso).getTime() - this.now();
    if (ms <= 0) return 'due now';
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60), rm = m % 60;
    return h === 0 ? `in ${rm} min` : rm ? `in ${h} h ${rm} min` : `in ${h} h`;
  }
  private startOfDay(d: Date): number { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
}
