import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  inject,
} from '@angular/core';

import { EstateService } from '../estate.service';
import { VillaArtComponent } from '../shared/villa-art.component';

/** A fund inside a level's unlock mix. */
interface FundVM {
  name: string;
  amount: string;
  pct: string;
  bar: string;
  isVault: boolean;
  isGold: boolean;
  isLarge: boolean;
  isMid: boolean;
  isSmall: boolean;
}

/** One step marker inside the ladder card. */
interface StepVM { done: boolean; glow: boolean; }

/** A fully-derived level rung in the ladder. */
interface LevelVM {
  level: number;
  name: string;
  tagline: string;
  milestone: string;
  startLabel: string;
  threshold: number;
  // state
  isDone: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  // stage
  isPlot: boolean;
  isGrading: boolean;
  isFoundation: boolean;
  isSteel: boolean;
  isVilla: boolean;
  // steps
  steps: StepVM[];
  stepsLabel: string;
  // percentile
  pctLabel: string;      // e.g. "10"
  pctPrefix: string;     // "You're in the top ~" | "Reach this → top ~" | "Top ~"
  // above-teaser (villa only)
  isTop: boolean;
  hasAbove: boolean;
  above: number;
  aboveName: string;
  // funds
  funds: FundVM[];
}

/** One marker on the vertical rail. */
interface RailMark {
  isNode: boolean;
  isTick: boolean;
  top: string;
  bg?: string;
  color?: string;
  label?: string;
}

/**
 * Estate Levels — a full-screen, game-style vertical level ladder showing how the
 * user's SIP builds one villa across five ₹1L rungs (villa complete at ₹5L). A
 * live progress rail on the left fills from ₹0 up to the current worth, and each
 * rung carries a "top ~X% of Indians" wealth-percentile pill.
 *
 * Ported from the decompiled design reference (renderVals): the level model,
 * rail geometry (SEC/OFF/RT/RB spans + yFor), fund mix, and keyframe animations.
 */
@Component({
  selector: 'app-estate-levels',
  standalone: true,
  imports: [CommonModule, VillaArtComponent],
  templateUrl: './estate-levels.component.html',
  styleUrl: './estate-levels.component.scss',
})
export class EstateLevelsComponent implements AfterViewInit {
  @Output() back = new EventEmitter<void>();
  @ViewChild('scroller') scroller!: ElementRef<HTMLDivElement>;

  private est = inject(EstateService);

  // --- constants (ported from renderVals) ---
  private readonly L = 100000;
  private readonly STEPS = 4;
  private readonly SIP = 25000;

  // rail section geometry (px): each section is SEC tall; the rail is drawn from
  // RT (below the HUD) to RB (above the section bottom), split into 4 partitions.
  private readonly SEC = 754;
  private readonly OFF = 100;
  private readonly RT = 40;
  private readonly RB = this.SEC - 300;               // 454
  private readonly SPAN = this.RB - this.RT;          // 414

  /** Wealth percentile per level, top ~X% of Indian adults by net worth.
   *  Source: Credit Suisse Global Wealth Report — ~91% of Indian adults hold
   *  under ₹7.3L, and the top 1% hold ≈ ₹1.5Cr. The ladder's ₹1L–₹5L rungs sit
   *  inside the broad middle, so the percentile tightens slowly:
   *  ₹1L→~35%, ₹2L→~25%, ₹3L→~18%, ₹4L→~13%, ₹5L (villa)→~10%. */
  private readonly PERCENTILE = ['35', '25', '18', '13', '10'];

  private readonly FUNDS = [
    { name: 'Arbitrage', w: 0.36, bar: '#8aa89b', isVault: true, isGold: false, isLarge: false, isMid: false, isSmall: false },
    { name: 'Gold', w: 0.16, bar: '#f6c445', isVault: false, isGold: true, isLarge: false, isMid: false, isSmall: false },
    { name: 'Large cap', w: 0.16, bar: '#4a9d47', isVault: false, isGold: false, isLarge: true, isMid: false, isSmall: false },
    { name: 'Mid cap', w: 0.16, bar: '#5cb85c', isVault: false, isGold: false, isLarge: false, isMid: true, isSmall: false },
    { name: 'Small cap', w: 0.16, bar: '#8fd48a', isVault: false, isGold: false, isLarge: false, isMid: false, isSmall: true },
  ];

  private readonly DEFS = [
    { level: 1, name: 'The Plot', tagline: 'Land in your name. 100% equity, valued at NAV, moving daily.' },
    { level: 2, name: 'Levelled Ground', tagline: 'The site is cleared and graded flat. Your first lakh is working.' },
    { level: 3, name: 'Foundation', tagline: 'Formwork set, concrete poured. Halfway to the villa.' },
    { level: 4, name: 'Steel Frame', tagline: 'Columns and beams up. One more level and the house is yours.' },
    { level: 5, name: 'The Villa', tagline: 'Monthly income of ₹15,000 arrives automatically by SWP.' },
  ];

  // --- currency helpers ---
  private inr(n: number): string { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  private lakh(n: number): string {
    return n >= 100000
      ? '₹' + (n / 100000).toFixed(n % 100000 ? 2 : 0).replace(/\.?0+$/, '') + 'L'
      : n >= 1000 ? '₹' + Math.round(n / 1000) + 'k' : this.inr(n);
  }

  /** Live worth (₹) from the estate service. */
  readonly worth = computed(() => Math.max(0, this.est.estateValue));
  /** Current level: 1..5, one past the last fully-crossed lakh. */
  readonly current = computed(() => Math.min(5, Math.floor(this.worth() / this.L) + 1));

  readonly worthLabel = computed(() => this.lakh(this.worth()));
  readonly sipLabel = computed(() => this.inr(this.SIP));

  /** The five rungs, villa first (top of the scroll) and plot last (bottom). */
  readonly levels = computed<LevelVM[]>(() => {
    const worth = this.worth();
    const current = this.current();
    return this.DEFS.map((d) => {
      const threshold = d.level * this.L;
      const start = threshold - this.L;
      const isDone = d.level < current;
      const isCurrent = d.level === current;
      const isLocked = d.level > current;
      const done = isDone ? this.STEPS : isLocked ? 0 : Math.min(this.STEPS, Math.floor((worth - start) / this.SIP));
      const steps: StepVM[] = Array.from({ length: this.STEPS }, (_, i) => ({
        done: i < done,
        glow: i < done && isCurrent,
      }));
      const funds: FundVM[] = this.FUNDS.map((f) => ({
        name: f.name,
        amount: this.inr(threshold * f.w),
        pct: Math.round(f.w * 100) + '%',
        bar: f.bar,
        isVault: f.isVault,
        isGold: f.isGold,
        isLarge: f.isLarge,
        isMid: f.isMid,
        isSmall: f.isSmall,
      }));
      const pctPrefix = isCurrent ? "You're in the top ~" : isLocked ? 'Reach this → top ~' : 'Top ~';
      return {
        level: d.level,
        name: d.name,
        tagline: d.tagline,
        milestone: this.inr(threshold),
        startLabel: this.inr(start),
        threshold,
        isDone,
        isCurrent,
        isLocked,
        isPlot: d.level === 1,
        isGrading: d.level === 2,
        isFoundation: d.level === 3,
        isSteel: d.level === 4,
        isVilla: d.level === 5,
        steps,
        stepsLabel: isLocked ? 'Locked' : `${done} of ${this.STEPS} steps`,
        pctLabel: this.PERCENTILE[d.level - 1],
        pctPrefix,
        isTop: d.level === 5,
        hasAbove: d.level < 5,
        above: d.level + 1,
        aboveName: this.DEFS[d.level] ? this.DEFS[d.level].name : '',
        funds,
      };
    }).reverse();
  });

  // --- rail geometry (ported from yFor / railMarks) ---
  private yFor(v: number): number {
    const vv = Math.min(5 * this.L, Math.max(0, v));
    const n = Math.min(5, Math.floor(vv / this.L) + 1);
    const f = (vv - (n - 1) * this.L) / this.L;
    return this.OFF + (5 - n) * this.SEC + this.RB - f * this.SPAN;
  }

  readonly fillTop = computed(() => Math.round(this.yFor(this.worth())) + 'px');
  readonly railTop = this.RT + 'px';

  readonly railMarks = computed<RailMark[]>(() => {
    const worth = this.worth();
    const marks: RailMark[] = [];
    for (let n = 5; n >= 1; n--) {
      const top = this.OFF + (5 - n) * this.SEC;
      // top node of the section = ₹N·L
      marks.push({
        isNode: true,
        isTick: false,
        top: (top + this.RT) + 'px',
        bg: n * this.L <= worth ? '#d2cefd' : '#3f424d',
        color: n * this.L <= worth ? '#c9c6da' : '#6b6e79',
        label: this.lakh(n * this.L),
      });
      for (let i = 1; i < this.STEPS; i++) {
        marks.push({
          isNode: false,
          isTick: true,
          top: Math.round(top + this.RB - (i / this.STEPS) * this.SPAN) + 'px',
        });
      }
      // bottom node of the section = ₹(N−1)L
      marks.push({
        isNode: true,
        isTick: false,
        top: (top + this.RB) + 'px',
        bg: (n - 1) * this.L <= worth ? '#d2cefd' : '#3f424d',
        color: (n - 1) * this.L <= worth ? '#c9c6da' : '#6b6e79',
        label: n === 1 ? '₹0' : '',
      });
    }
    return marks;
  });

  /** Start scrolled to the bottom — the plot rung — so the user climbs upward. */
  ngAfterViewInit(): void {
    const el = this.scroller?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  onBack(): void { this.back.emit(); }

  trackLevel(_i: number, lv: LevelVM): number { return lv.level; }
  trackMark(i: number, _m: RailMark): number { return i; }
  trackFund(_i: number, f: FundVM): string { return f.name; }
  trackStep(i: number, _s: StepVM): number { return i; }
}
