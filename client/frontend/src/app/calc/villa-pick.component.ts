import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject, signal } from '@angular/core';

import { PORTFOLIOS } from './backtest.model';
import { CalcDataService } from './calc-data.service';

/**
 * The DigiVilla header every calculator shares: SWP pill → coin → villa, with
 * ← → stepping Conservative → Balanced → Aggressive (no wrap; swipe the villa
 * too). The choice lives in CalcDataService, so every calculator follows it.
 * The new villa slides in from the side you stepped towards, with a glow in its
 * risk colour; the coin drops away when SWP is off.
 */
@Component({
  selector: 'app-villa-pick',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="vp" [class.hero]="size === 'hero'" [attr.data-r]="pf().risk">
      <button class="swp" type="button" role="switch" [attr.aria-checked]="store.swp()" [class.on]="store.swp()"
              (click)="toggleSwp()" aria-label="Monthly SWP">
        <span class="trk"><i></i></span><span class="t">SWP</span>
      </button>
      <div class="row">
        <span class="slot">
          @if (idx() > 0) {
            <button class="arr l" type="button" (click)="step(-1)" [attr.aria-label]="'Show the ' + PF[idx() - 1].name + ' villa'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 3 2 12l9 9v-5.5h11v-7H11z"/></svg>
            </button>
          }
        </span>
        <span class="stage" (touchstart)="t0($event)" (touchend)="t1($event)">
          @for (k of [pf().key]; track k) {
            <i class="halo" [class.pulse]="moved()"></i>
            <img class="villa" [class.from-l]="dir() < 0" [class.from-r]="dir() > 0" src="assets/calc/villa.svg" alt="" draggable="false" />
          }
          <img class="coin" [class.off]="!store.swp()" src="assets/calc/coin.svg" alt="" />
        </span>
        <span class="slot">
          @if (idx() < PF.length - 1) {
            <button class="arr r" type="button" (click)="step(1)" [attr.aria-label]="'Show the ' + PF[idx() + 1].name + ' villa'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3l9 9-9 9v-5.5H2v-7h11z"/></svg>
            </button>
          }
        </span>
      </div>
      @for (k of [pf().key]; track k) {
        <span class="nm" [class.from-l]="dir() < 0" [class.from-r]="dir() > 0" aria-live="polite">
          <b>{{ pf().name }}</b>@if (rate() !== null) {<em>{{ rate()!.toFixed(1) }}% a yr</em>}
        </span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .vp { --rc: #e9c15c; position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; user-select: none; -webkit-user-select: none; }
    .vp[data-r="1"] { --rc: #8fd65a; } .vp[data-r="3"] { --rc: #e0796b; }
    button { font: inherit; -webkit-tap-highlight-color: transparent; }

    /* SWP pill */
    .swp {
      display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px 0 4px; border: 0; border-radius: 11px; cursor: pointer; white-space: nowrap;
      color: #b2b6ca; background: rgba(43, 46, 58, .7); box-shadow: inset 0 0 0 1px #595d6c;
      transition: background .25s, box-shadow .25s, color .25s;
      .trk { position: relative; width: 22px; height: 12px; border-radius: 6px; background: #595d6c; transition: background .25s; }
      .trk i { position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: #b2b6ca; transition: left .25s cubic-bezier(.2, .8, .2, 1), background .25s; }
      .t { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; }
    }
    .swp.on {
      color: #f3dfa8; background: rgba(233, 193, 92, .14); box-shadow: inset 0 0 0 1px rgba(233, 193, 92, .45), 0 0 16px -4px rgba(233, 193, 92, .5);
      .trk { background: #e9c15c; } .trk i { left: 12px; background: #1a1406; }
    }
    .swp:focus-visible, .arr:focus-visible { outline: 2px solid #9184d9; outline-offset: 2px; }

    .row { display: flex; align-items: flex-end; gap: 4px; }
    .slot { flex: none; width: 22px; display: flex; justify-content: center; }
    .arr {
      width: 22px; height: 22px; margin-bottom: 18px; border: 0; border-radius: 6px; padding: 0; cursor: pointer; display: grid; place-items: center;
      color: #b2b6ca; background: transparent; transition: color .2s, transform .2s; animation: arrIn .35s ease both;
    }
    .arr.l:hover { color: #f3dfa8; transform: translateX(-2px); }
    .arr.r:hover { color: #f3dfa8; transform: translateX(2px); }
    .arr:active { transform: scale(.88); }
    @keyframes arrIn { from { opacity: 0; } to { opacity: 1; } }

    .stage { position: relative; display: flex; align-items: flex-end; justify-content: center; width: 92px; height: 66px; touch-action: pan-y; }
    .villa { position: relative; z-index: 1; height: 58px; filter: drop-shadow(0 12px 14px rgba(0, 0, 0, .55)); }
    .halo {
      position: absolute; left: 50%; bottom: 2px; width: 96px; height: 34px; margin-left: -48px; border-radius: 50%; pointer-events: none;
      background: radial-gradient(closest-side, color-mix(in srgb, var(--rc) 55%, transparent), transparent); opacity: .5;
    }
    .halo.pulse { animation: halo .9s ease-out both; }
    @keyframes halo { 0% { opacity: 0; transform: scale(.4); } 35% { opacity: 1; transform: scale(1.25); } 100% { opacity: .5; transform: scale(1); } }
    .villa.from-r { animation: inR .62s cubic-bezier(.2, .9, .25, 1.15) both; }
    .villa.from-l { animation: inL .62s cubic-bezier(.2, .9, .25, 1.15) both; }
    @keyframes inR { 0% { opacity: 0; transform: translateX(34px) translateY(6px) scale(.62) rotate(4deg); } 60% { opacity: 1; } 100% { opacity: 1; transform: none; } }
    @keyframes inL { 0% { opacity: 0; transform: translateX(-34px) translateY(6px) scale(.62) rotate(-4deg); } 60% { opacity: 1; } 100% { opacity: 1; transform: none; } }
    .coin {
      position: absolute; z-index: 2; left: 50%; top: 0; width: 18px; animation: bob 4.5s ease-in-out infinite;
      transition: opacity .3s, transform .3s;
    }
    .coin.off { opacity: 0; animation: none; transform: translate(-50%, 10px) scale(.6); }
    @keyframes bob { 0%, 100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -6px); } }

    .nm { display: flex; align-items: baseline; gap: 6px; height: 16px; white-space: nowrap; font-size: 11px; }
    .nm b { font-weight: 500; color: var(--rc); letter-spacing: -.01em; }
    .nm em { font-style: normal; color: #9397ab; font-variant-numeric: tabular-nums; }
    .nm.from-r { animation: nmR .45s ease both; } .nm.from-l { animation: nmL .45s ease both; }
    @keyframes nmR { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
    @keyframes nmL { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }

    .vp.hero { .stage { width: 104px; height: 84px; } .villa { height: 76px; } .halo { width: 112px; height: 40px; margin-left: -56px; } .coin { width: 20px; top: -4px; } .arr { margin-bottom: 26px; } .slot { width: 18px; } }

    @media (max-height: 760px) {
      .stage { height: 54px; } .villa { height: 48px; }
      .vp.hero { .stage { height: 76px; width: 108px; } .villa { height: 70px; } }
    }
    @media (prefers-reduced-motion: reduce) {
      .villa, .nm, .halo.pulse, .coin, .arr { animation: none !important; }
    }
  `],
})
export class VillaPickComponent {
  /** 'col' sits above a 3D column; 'hero' is the bigger art beside SIP / Lumpsum's headline */
  @Input() size: 'col' | 'hero' = 'col';
  readonly store = inject(CalcDataService);
  readonly PF = PORTFOLIOS;
  readonly idx = computed(() => PORTFOLIOS.findIndex((p) => p.key === this.store.villa()));
  readonly pf = computed(() => PORTFOLIOS[this.idx()]);
  readonly rate = computed(() => this.store.rates()?.[this.pf().key] ?? null);
  /** the side the new villa comes in from (0 = no animation, e.g. first paint) */
  readonly dir = signal(0);
  readonly moved = signal(false);

  step(d: number): void {
    const i = this.idx() + d;
    if (i < 0 || i >= PORTFOLIOS.length) return;
    this.dir.set(d);
    this.moved.set(true);
    this.store.villa.set(PORTFOLIOS[i].key);
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
  }
  toggleSwp(): void { this.store.swp.set(!this.store.swp()); }

  private x0: number | null = null;
  t0(e: TouchEvent): void { this.x0 = e.touches[0]?.clientX ?? null; }
  t1(e: TouchEvent): void {
    if (this.x0 === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? this.x0) - this.x0;
    this.x0 = null;
    if (Math.abs(dx) > 36) this.step(dx < 0 ? 1 : -1);
  }
}
