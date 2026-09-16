import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

import { EstateService } from '../estate.service';

/**
 * DATA FRESHNESS — the one place the app says, plainly, how current the money
 * figures are:
 *
 *   • the collapsed pill:  "Values as of 15 Sep · loaded 2 min ago"
 *     — turns into a spinner + "Reloading values…" while a reload is in flight,
 *       then flashes green "Values reloaded just now" for a few seconds.
 *   • tap to expand: WHEN the latest value was loaded (clock time + ago), the
 *     NAV date the value is built on, WHEN the next NAV update lands (with a
 *     live countdown), how/when the app reloads, and a "Refresh now" button.
 *
 * Drop `<app-data-freshness>` under any ₹ figure. It reads everything from
 * EstateService (portfolio(), lastLoadedAt(), refreshing()) so every screen
 * shows the same truth.
 */
@Component({
  selector: 'app-data-freshness',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fr" [class.open]="open()" [class.busy]="est.refreshing()" [class.fresh]="justLoaded()" [class.err]="!est.lastLoadOk()">
      <button type="button" class="fr-pill" (click)="toggle()" [attr.aria-expanded]="open()" aria-controls="fr-panel">
        <span class="fr-dot" aria-hidden="true"><i></i></span>
        <span class="fr-txt" aria-live="polite">{{ pillText() }}</span>
        <svg class="fr-chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>

      <div class="fr-backdrop" *ngIf="open()" (click)="open.set(false)" aria-hidden="true"></div>
      <div class="fr-panel" id="fr-panel" role="dialog" aria-label="How fresh are these values" *ngIf="open()">
        <div class="fr-head">
          <b>About these values</b>
          <button type="button" class="fr-x" (click)="open.set(false)" aria-label="Close">×</button>
        </div>
        <div class="fr-row">
          <span class="fr-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
          <div class="fr-body">
            <span class="fr-k">Latest value loaded</span>
            <b class="fr-v" *ngIf="est.lastLoadedAt() as t; else never">{{ t | date:'h:mm a' }} <small>· {{ ago(t) }}</small></b>
            <ng-template #never><b class="fr-v muted">Not yet</b></ng-template>
          </div>
        </div>

        <div class="fr-row">
          <span class="fr-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
          <div class="fr-body">
            <span class="fr-k">Built on NAVs dated</span>
            <b class="fr-v" *ngIf="navDate() as d; else nonav">{{ d | date:'EEE, d MMM y' }}</b>
            <ng-template #nonav><b class="fr-v muted">—</b></ng-template>
            <span class="fr-note">NAVs are published once a day by the fund houses, after 11 PM.</span>
          </div>
        </div>

        <div class="fr-row">
          <span class="fr-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.3 5.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 17.5V13h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <div class="fr-body">
            <span class="fr-k">Next NAV update</span>
            <b class="fr-v" *ngIf="nextRefresh() as n; else nonext">{{ nextLabel(n) }} <small>· {{ countdown(n) }}</small></b>
            <ng-template #nonext><b class="fr-v muted">—</b></ng-template>
            <span class="fr-note">Your values reload automatically when you open the app, when you come back to it, and whenever you tap Refresh.</span>
          </div>
        </div>

        <button type="button" class="fr-btn" (click)="refresh()" [disabled]="est.refreshing()">
          <span class="fr-spin" *ngIf="est.refreshing(); else refIcon"></span>
          <ng-template #refIcon><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 6.5V11h-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></ng-template>
          {{ est.refreshing() ? 'Reloading…' : 'Refresh now' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fr { --fr-c: var(--muted, #8B95A3); display: flex; flex-direction: column; align-items: center; }

    /* ---- the pill ---- */
    .fr-pill {
      display: inline-flex; align-items: center; gap: 7px; max-width: 100%;
      padding: 5px 10px 5px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04); color: var(--fr-c); font: 500 11.5px/1 var(--font-body, Inter, system-ui, sans-serif);
      letter-spacing: 0.01em; cursor: pointer; transition: background .3s, border-color .3s, color .3s, transform .3s cubic-bezier(.22,1,.36,1);
    }
    .fr-pill:hover { background: rgba(255,255,255,0.07); }
    .fr-pill:active { transform: scale(0.98); }
    .fr-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fr-chev { flex: none; transition: transform .35s cubic-bezier(.22,1,.36,1); opacity: .7; }
    .open .fr-chev { transform: rotate(180deg); }

    /* the status dot: idle grey · busy spinning ring · fresh green pulse · error amber */
    .fr-dot { position: relative; width: 12px; height: 12px; flex: none; display: grid; place-items: center; }
    .fr-dot i { width: 7px; height: 7px; border-radius: 50%; background: var(--fr-c); transition: background .3s, transform .3s; }
    .busy .fr-dot i { width: 10px; height: 10px; background: transparent; border: 2px solid rgba(139,123,240,.25); border-top-color: var(--brass, #8B7BF0); animation: fr-spin .8s linear infinite; }
    .busy .fr-pill { color: var(--ink, #EEF1F5); border-color: rgba(139,123,240,.35); }
    .fresh .fr-dot i { background: var(--positive, #64C37D); animation: fr-pulse 1.6s ease-out 2; }
    .fresh .fr-pill { color: var(--positive, #64C37D); border-color: rgba(100,195,125,.35); background: rgba(100,195,125,.08); }
    .err .fr-dot i { background: #E9C15C; }
    @keyframes fr-spin { to { transform: rotate(360deg); } }
    @keyframes fr-pulse { 0% { box-shadow: 0 0 0 0 rgba(100,195,125,.55); } 100% { box-shadow: 0 0 0 9px rgba(100,195,125,0); } }

    /* ---- the expanded panel ---- */
    /* the app's popup pattern (estate-home .pop-backdrop / .pop): blurred scrim + centred card,
       above the tab bar, so nothing on the screen moves when it opens */
    .fr-backdrop { position: fixed; inset: 0; z-index: 45; background: rgba(22, 48, 43, 0.42); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fr-fade .22s ease both; }
    .fr-panel {
      position: fixed; z-index: 46; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: min(92vw, 380px); display: grid; gap: 12px; padding: 14px 14px 12px; text-align: left;
      border-radius: 22px; background: var(--paper, #0E1116); border: 1px solid var(--survey, #2A323E);
      box-shadow: 0 30px 70px -24px rgba(22, 48, 43, 0.6);
      animation: fr-in .28s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes fr-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fr-in { from { opacity: 0; transform: translate(-50%, -46%) scale(.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
    .fr-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 2px; }
    .fr-head b { font-size: 15px; font-weight: 800; letter-spacing: -.01em; color: var(--ink, #EEF1F5); }
    .fr-x { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--survey, #2A323E); background: transparent; color: var(--muted, #8B95A3); font-size: 18px; line-height: 1; cursor: pointer; }
    .fr-row { display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start; }
    .fr-ico { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; background: var(--card, #171C25); color: var(--brass, #8B7BF0); }
    .fr-ico svg { width: 15px; height: 15px; }
    .fr-body { display: grid; gap: 2px; min-width: 0; }
    .fr-k { font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--muted, #8B95A3); }
    .fr-v { font-size: 14px; font-weight: 700; color: var(--ink, #EEF1F5); letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .fr-v small { font-size: 11.5px; font-weight: 500; color: var(--muted, #8B95A3); }
    .fr-v.muted { color: var(--muted, #8B95A3); font-weight: 500; }
    .fr-note { font-size: 11px; line-height: 1.4; color: var(--muted, #8B95A3); }
    .fr-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px; margin-top: 2px;
      padding: 9px 12px; border-radius: 11px; border: 0; cursor: pointer;
      background: linear-gradient(120deg, #8b7bf0, #6f5ce6); color: #fff; font: 700 12.5px/1 var(--font-body, Inter, system-ui, sans-serif);
      transition: transform .3s cubic-bezier(.22,1,.36,1), filter .2s;
    }
    .fr-btn:hover { filter: brightness(1.06); }
    .fr-btn:active { transform: scale(.98); }
    .fr-btn:disabled { opacity: .7; cursor: default; }
    .fr-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: fr-spin .8s linear infinite; }

    @media (prefers-reduced-motion: reduce) {
      .fr-panel, .fr-dot i, .fr-chev, .fr-pill, .fr-btn { animation: none !important; transition: none !important; }
    }
  `],
})
export class DataFreshnessComponent implements OnInit, OnDestroy {
  est = inject(EstateService);

  open = signal(false);
  /** A ticking clock so "2 min ago" and the countdown stay live. */
  private now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;

  navDate = computed(() => this.est.portfolio()?.nav_date ?? null);
  nextRefresh = computed(() => this.est.portfolio()?.next_refresh ?? null);
  /** True for a few seconds after a reload completes — drives the green flash. */
  justLoaded = computed(() => {
    const t = this.est.lastLoadedAt();
    return !!t && !this.est.refreshing() && this.now() - t < 4000;
  });

  pillText = computed(() => {
    if (this.est.refreshing()) return 'Reloading values…';
    if (!this.est.lastLoadOk()) return 'Couldn’t reload · showing last values';
    const t = this.est.lastLoadedAt();
    if (!t) return 'Loading values…';
    if (this.now() - t < 4000) return 'Values reloaded just now';
    const d = this.navDate();
    const nav = d ? `Values as of ${this.shortDate(d)}` : 'Values';
    return `${nav} · loaded ${this.ago(t)}`;
  });

  ngOnInit(): void {
    // tick fast right after a load (so the green flash ends on time), then slowly
    this.timer = setInterval(() => this.now.set(Date.now()), 1000);
  }
  ngOnDestroy(): void { if (this.timer) clearInterval(this.timer); }

  toggle(): void { this.open.update((v) => !v); if (navigator.vibrate) navigator.vibrate(3); }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.open.set(false); }
  refresh(): void { if (navigator.vibrate) navigator.vibrate(4); this.est.refreshNow(); }

  /** "just now" · "3 min ago" · "2 h 10 min ago" · "yesterday". */
  ago(t: number): string {
    const s = Math.max(0, Math.round((this.now() - t) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return rm ? `${h} h ${rm} min ago` : `${h} h ago`;
    return h < 48 ? 'yesterday' : `${Math.floor(h / 24)} days ago`;
  }

  /** "Tonight, 1:00 AM" / "Tomorrow, 1:00 AM" / "Thu, 1:00 AM". */
  nextLabel(iso: string): string {
    const n = new Date(iso), now = new Date(this.now());
    const time = n.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toUpperCase();
    const dayDiff = Math.round((this.startOfDay(n) - this.startOfDay(now)) / 86400000);
    if (dayDiff === 0) return `Today, ${time}`;
    if (dayDiff === 1) return (now.getHours() >= 18 ? 'Tonight' : 'Tomorrow') + `, ${time}`;
    return `${n.toLocaleDateString('en-IN', { weekday: 'short' })}, ${time}`;
  }
  /** "in 6 h 12 min" — or "any moment now" once due. */
  countdown(iso: string): string {
    const ms = new Date(iso).getTime() - this.now();
    if (ms <= 0) return 'any moment now';
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60), rm = m % 60;
    if (h === 0) return `in ${rm} min`;
    return rm ? `in ${h} h ${rm} min` : `in ${h} h`;
  }

  private shortDate(iso: string): string {
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  private startOfDay(d: Date): number { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
}
