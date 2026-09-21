import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';

import { CountUpDirective } from '../shared/count-up.directive';
import { compact, inr } from '../shared/format.util';

const L = 100_000;
const HOUSE = 5 * L;
const INCOME = 1500;
/**
 * PLOT UNLOCK — the sheet an EMPTY parcel on the home board opens.
 *
 * Says at which Estate Level this plot unlocks (house h opens at level
 * 5(h−1)+1, i.e. once the estate reaches ₹5L × (h−1)), how far away that is
 * from today, and the level at which it becomes a paying villa. Kept to a few
 * words on purpose — the grow page and the ladder carry the detail. Levels here
 * are counted on the same ₹ the board is generated from, so sheet and board
 * always agree. Rendered inside estate-home, so `#tVilla` resolves to the
 * board's own symbol.
 */
@Component({
  selector: 'app-plot-unlock',
  standalone: true,
  imports: [CommonModule, CountUpDirective],
  template: `
    <div class="pu-back" (click)="close.emit()"></div>
    <div class="pu" role="dialog" aria-modal="true" [attr.aria-label]="'Plot ' + pad(house)">
      <span class="grab"></span>
      <button type="button" class="x" (click)="close.emit()" aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>

      <!-- the villa that will stand here, still a silhouette, under a lock -->
      <div class="art">
        <span class="halo"></span>
        <svg viewBox="14 2 212 184" aria-hidden="true"><use href="#tVilla"></use></svg>
        <span class="lock" [class.open]="ready">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9.5" rx="2.5" fill="currentColor"/>
            <path class="shackle" d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </span>
      </div>

      <span class="k rise" style="--d:.30s">Plot {{ pad(house) }}</span>
      <h2 class="rise" style="--d:.38s" *ngIf="!ready">Unlocks at <em>Level {{ unlockLevel }}</em></h2>
      <h2 class="rise" style="--d:.38s" *ngIf="ready"><em>Ready to build</em></h2>
      <p class="sub rise" style="--d:.46s" *ngIf="!ready"><b [appCountUp]="toGo" [countDuration]="900"></b> to go</p>

      <!-- where you are → where it unlocks -->
      <div class="prog rise" style="--d:.56s" *ngIf="!ready">
        <div class="track"><i [style.width.%]="pct"></i><span class="pin" [style.left.%]="pct"></span><span class="goal"></span></div>
        <div class="ends"><span>Level {{ level }}</span><span>Level {{ unlockLevel }}</span></div>
      </div>

      <div class="pay rise" style="--d:.95s">
        <span class="sheen"></span>
        <span class="coin">₹</span>
        <span class="t"><b>Villa at Level {{ villaLevel }}</b><i>{{ compact(villaAt) }}</i></span>
        <b class="amt">+{{ inr(INCOME) }}<i>/mo*</i></b>
      </div>

      <div class="acts rise" style="--d:1.1s">
        <button type="button" class="p" (click)="grow.emit()">Get there</button>
        <button type="button" class="s" (click)="levels.emit()">Levels</button>
      </div>
      <p class="fine rise" style="--d:1.2s">*Not fixed or assured</p>
    </div>
  `,
  styles: [`
    :host { --surface: #1e2130; --text: #e9e9ed; --n300: #c9c6da; --n400: #9a9aa5; --n500: #6b6e79; --n700: #3f424d; --n800: #2b2e3a; --acc100: #efedfc; --acc200: #d2cefd; --acc300: #b5abfc; --acc600: #796cbf;
      color: var(--text); font: 400 14px/1.5 Inter, system-ui, sans-serif; }
    b { font-weight: 500; }
    .pu-back { position: fixed; inset: 0; z-index: 60; background: rgba(8,9,16,.62); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); animation: puFade .25s ease both; }
    .pu { position: fixed; z-index: 61; left: 50%; bottom: 0; width: min(100%, 460px); max-height: 92dvh; overflow-y: auto; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; text-align: center;
      padding: 10px 20px calc(env(safe-area-inset-bottom, 0px) + 18px); border-radius: 26px 26px 0 0;
      background: radial-gradient(120% 60% at 50% 0%, #25284a 0%, #181a2a 62%); box-shadow: 0 0 0 1px var(--n800), 0 -24px 60px rgba(0,0,0,.55);
      animation: puUp .42s cubic-bezier(.2,.9,.25,1) both; }
    @keyframes puUp { from { transform: translate(-50%, 100%); } to { transform: translate(-50%, 0); } }
    @keyframes puFade { from { opacity: 0; } to { opacity: 1; } }
    .grab { width: 38px; height: 4px; border-radius: 2px; background: var(--n700); flex: none; }
    .x { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; color: var(--n300); background: rgba(255,255,255,.06); }

    .art { position: relative; width: 190px; height: 150px; margin-top: 4px; display: grid; place-items: center; }
    .art > svg { position: relative; width: 172px; height: 150px; filter: grayscale(1) brightness(.5) contrast(1.1); animation: puArt .6s cubic-bezier(.2,.9,.25,1) .15s both; }
    @keyframes puArt { from { opacity: 0; transform: translateY(18px) scale(.92); } to { opacity: .75; transform: none; } }
    .halo { position: absolute; inset: 0 -20px; border-radius: 50%; background: radial-gradient(closest-side, rgba(145,132,217,.30), transparent 72%); animation: puGlow 3.4s ease-in-out infinite; }
    @keyframes puGlow { 0%,100% { opacity: .6; transform: scale(.95); } 50% { opacity: 1; transform: scale(1.05); } }
    .lock { position: absolute; left: 50%; top: 40%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; display: grid; place-items: center; color: #2b2741; background: var(--acc100); box-shadow: 0 0 0 6px rgba(145,132,217,.28), 0 8px 20px rgba(0,0,0,.5); animation: puLockIn .55s cubic-bezier(.2,1.6,.4,1) .5s both, puWiggle .7s ease-in-out 1.15s both, puBob 2.8s ease-in-out 2s infinite; }
    /* a ring keeps pulsing out of the lock, so it reads as the thing to look at */
    .lock::after { content: ''; position: absolute; inset: 0; border-radius: 50%; box-shadow: 0 0 0 2px var(--acc300); opacity: 0; animation: puRing 2.2s ease-out 1.3s infinite; }
    .lock.open::after { box-shadow: 0 0 0 2px #f6c445; }
    .lock svg { display: block; overflow: visible; }
    .lock.open { color: #4a370a; background: #f6c445; box-shadow: 0 0 0 6px rgba(246,196,69,.25), 0 8px 20px rgba(0,0,0,.5); }
    .lock.open .shackle { transform: translate(3px, -2px) rotate(18deg); transform-origin: 16px 11px; }
    @keyframes puBob { 0%,100% { translate: 0 0; } 50% { translate: 0 -5px; } }
    @keyframes puLockIn { from { opacity: 0; scale: .2; translate: 0 -26px; } to { opacity: 1; scale: 1; translate: 0 0; } }
    @keyframes puWiggle { 0%,100% { rotate: 0deg; } 20% { rotate: -14deg; } 40% { rotate: 12deg; } 60% { rotate: -8deg; } 80% { rotate: 5deg; } }
    @keyframes puRing { 0% { opacity: .8; transform: scale(1); } 100% { opacity: 0; transform: scale(2.1); } }

    /* text + cards rise in one after the other, each on its own --d delay */
    .rise { animation: puRise .5s cubic-bezier(.2,.8,.2,1) var(--d, 0s) both; }
    @keyframes puRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

    .k { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--n500); margin-top: 2px; }
    h2 { margin: 2px 0 0; font-size: 26px; font-weight: 500; letter-spacing: -.025em; line-height: 1.2; }
    h2 em { font-style: normal; color: var(--acc300); }
    .sub { margin: 4px 0 0; font-size: 14px; color: var(--n400); } .sub b { color: var(--text); font-variant-numeric: tabular-nums; }

    .prog { width: 100%; margin-top: 16px; padding: 14px; border-radius: 16px; background: var(--surface); box-shadow: 0 0 0 1px var(--n800); }
    .ends { display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 500; color: var(--n300); font-variant-numeric: tabular-nums; }
    .track { position: relative; height: 8px; margin: 4px 0 12px; border-radius: 4px; background: rgba(11,13,22,.6); }
    .track i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--acc600), var(--acc300)); animation: puBar 1.2s cubic-bezier(.3,.7,.2,1) .8s both; }
    .track .pin { position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: var(--acc100); box-shadow: 0 0 0 4px rgba(145,132,217,.3); animation: puPin 1.2s cubic-bezier(.3,.7,.2,1) .8s both; }
    .track .goal { position: absolute; right: -2px; top: 50%; width: 12px; height: 12px; margin-top: -6px; border-radius: 50%; background: #181a2a; box-shadow: inset 0 0 0 2px var(--acc300); animation: puGoal 1.8s ease-in-out 2s infinite; }
    /* 'from' only: they run up to the width / left bound inline from the real ₹ */
    @keyframes puBar { from { width: 0; } }
    @keyframes puPin { from { left: 0; } }
    @keyframes puGoal { 0%,100% { box-shadow: inset 0 0 0 2px var(--acc300), 0 0 0 0 rgba(181,171,252,.5); } 50% { box-shadow: inset 0 0 0 2px var(--acc300), 0 0 0 7px rgba(181,171,252,0); } }

    .pay { position: relative; overflow: hidden; width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; margin-top: 12px; padding: 12px 14px; border-radius: 16px; background: linear-gradient(120deg, #352b10, #1e2130 75%); box-shadow: 0 0 0 1px #5a4419; }
    .pay .t { flex: 1; min-width: 0; display: flex; flex-direction: column; } .pay .t b { font-size: 14px; color: #ffe9a3; } .pay i { font-style: normal; font-size: 11.5px; font-weight: 400; color: #b9a776; font-variant-numeric: tabular-nums; }
    .pay .amt { flex: none; font-size: 19px; letter-spacing: -.02em; color: #ffe9a3; font-variant-numeric: tabular-nums; }
    .pay .sheen { position: absolute; top: 0; bottom: 0; left: 0; width: 40%; pointer-events: none; background: linear-gradient(100deg, transparent, rgba(255,233,163,.16), transparent); transform: translateX(-120%); animation: puSheen 3.6s ease-in-out 1.5s infinite; }
    @keyframes puSheen { 0% { transform: translateX(-120%); } 45%,100% { transform: translateX(320%); } }
    .coin { animation: puCoin .9s cubic-bezier(.3,.7,.2,1) 1.1s both; width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 14px; font-weight: 600; color: #6b5111; background: radial-gradient(circle at 34% 28%, #ffe9a3, #f6c445 45%, #dc9a1f 80%); box-shadow: 0 0 0 1px #8d5a10; }

    .acts { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 16px; }
    .acts button { height: 50px; padding: 0 18px; border: 0; border-radius: 16px; font: inherit; font-size: 14.5px; font-weight: 500; cursor: pointer; transition: transform .15s; } .acts button:active { transform: scale(.97); }
    .acts .p { background: var(--acc100); color: #2b2741; } .acts .s { background: var(--surface); color: var(--acc200); box-shadow: inset 0 0 0 1px var(--n800); }
    @keyframes puCoin { from { transform: rotateY(-360deg) scale(.6); } to { transform: none; } }
    .fine { margin: 10px 0 0; font-size: 10.5px; color: var(--n500); }

    @media (prefers-reduced-motion: reduce) { .pu-back, .pu, .halo, .lock, .lock::after, .art > svg, .rise, .track i, .track .pin, .track .goal, .coin, .pay .sheen { animation: none !important; } }
  `],
})
export class PlotUnlockComponent implements OnInit, OnDestroy {
  // The shell's floating tab bar is fixed over the same bottom edge — hide it
  // while this sheet is up (same body flag the live-values sheet uses).
  ngOnInit(): void { document.body.classList.add('lv-sheet-open'); }
  ngOnDestroy(): void { document.body.classList.remove('lv-sheet-open'); }

  /** Which house this parcel is (1-based position in the board's fill order). */
  @Input() house = 1;
  /** The ₹ the board is generated from (invested, capped at nine villas). */
  @Input() worth = 0;
  @Output() close = new EventEmitter<void>();
  /** "See what gets you there" → the grow-your-estate page. */
  @Output() grow = new EventEmitter<void>();
  /** "All levels" → the Estate Levels ladder. */
  @Output() levels = new EventEmitter<void>();

  inr = inr;
  compact = compact;
  readonly HOUSE = HOUSE;
  readonly INCOME = INCOME;

  pad(n: number): string { return ('0' + n).slice(-2); }

  /** The level the client is on now: every ₹1L is a level, starting at 1. */
  get level(): number { return Math.min(45, Math.floor(this.worth / L) + 1); }
  /** ₹ at which this plot opens = every house before it complete. */
  get unlockAt(): number { return (this.house - 1) * HOUSE; }
  get unlockLevel(): number { return (this.house - 1) * 5 + 1; }
  get villaLevel(): number { return this.house * 5; }
  get villaAt(): number { return this.house * HOUSE; }
  get toGo(): number { return Math.max(0, this.unlockAt - this.worth); }
  /** Already open (the estate sits exactly on the previous villa's completion). */
  get ready(): boolean { return this.toGo <= 0; }
  get pct(): number { return this.unlockAt > 0 ? Math.max(3, Math.min(100, this.worth / this.unlockAt * 100)) : 100; }

}
