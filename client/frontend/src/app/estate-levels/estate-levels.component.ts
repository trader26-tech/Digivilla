import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';

import { EstateService } from '../estate.service';

/** A fund inside a level's unlock mix. */
interface FundVM {
  name: string;
  amount: string;
  bar: string;
  border: string;
  shadow: string;
  isVault: boolean;
  isGold: boolean;
  isLarge: boolean;
  isMid: boolean;
  isSmall: boolean;
}

/** One isometric board cell (dashed empty plot). */
interface CellVM { pts: string; fill: string; stroke: string; sw: number; dash: string; anim: string; }
/** A completed-villa symbol placement on the board. */
interface VillaVM { tf: string; }
/** A fountaining coin on a paid-out credit panel. */
interface BurstVM { left: string; size: string; delay: string; }

/** A fully-derived level rung in the ladder (ported 1:1 from renderVals). */
interface LevelVM {
  level: number;
  name: string;
  milestone: string;
  startLabel: string;
  threshold: number;
  // state
  isDone: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  // stage flags
  isPlot: boolean;
  isGrading: boolean;
  isFoundation: boolean;
  isSteel: boolean;
  isVilla: boolean;
  // board
  backCells: CellVM[];
  frontCells: CellVM[];
  backVillas: VillaVM[];
  frontVillas: VillaVM[];
  boardVB: string;
  tileH: string;
  artLeft: string;
  artTop: string;
  nextX: number;
  nextY: number;
  nextTY: number;
  nextDisplay: string;
  mapLabel: string;
  mapLabelColor: string;
  boardFilter: string;
  // chips
  showStatus: boolean;
  chipTop: string;
  statusText: string;
  statusBg: string;
  statusColor: string;
  statusBorder: string;
  statusGlow: string;
  // title + banner
  titleColor: string;
  titleGlow: string;
  bannerTop: string;
  bannerBottom: string;
  pillBorder: string;
  // credit panel (villa only)
  incomeLabel: string;
  payLocked: boolean;
  housePct: string;
  paidLabel: string;
  goalLabel: string;
  payBg: string;
  payShadow: string;
  payGlowA: string;
  payColor: string;
  payTextGlow: string;
  payFilter: string;
  coinFilter: string;
  payRight: string;
  unlockLabel: string;
  burst: BurstVM[];
  unlockAnim: string;
  coinAnim: string;
  ringAnim: string;
  ringAnim2: string;
  sheenAnim: string;
  // funds
  funds: FundVM[];
  tileFilter: string;
  tileOpacity: number;
  // above-teaser
  isTop: boolean;
  hasAbove: boolean;
  above: number;
  aboveName: string;
}

/** One marker on the vertical rail (villa-completion checkpoint or the ₹0 base). */
interface RailMark {
  top: string;
  size: string;
  reached: boolean;
  isFlag: boolean;
  flagFill: string;
  bg: string;
  glow: string;
  color: string;
  tagBg: string;
  label: string;
  /** A small per-level checkpoint dot (no label) vs a big labelled villa milestone. */
  isTick: boolean;
}

/**
 * Estate Levels — the 45-level, game-style estate ladder (Progress screen).
 * 9 houses × 5 build stages (The Plot · Levelled Ground · Foundation ·
 * Steel Frame · The Villa), each stage = ₹1L. A live rail on the left fills
 * from ₹0 to the user's real portfolio worth; each rung shows the isometric
 * build-stage art on a 3×3 estate board, the fund unlock mix, and — on villa
 * rungs — the ₹1,500×h/month income plan.
 *
 * Ported verbatim from the decompiled reference (Villa Ladder renderVals):
 * the level model, board geometry (BW/BH/OX/ORDER + depth sort), rail geometry
 * (SEC/OFF/RT/RB + yFor), fund mix, HUD earn target, and every keyframe.
 * Worth is read from EstateService.estateValue (real ₹).
 */
@Component({
  selector: 'app-estate-levels',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './estate-levels.component.html',
  styleUrl: './estate-levels.component.scss',
})
export class EstateLevelsComponent implements AfterViewInit {
  @Output() back = new EventEmitter<void>();
  /** True when shown as the bottom-nav "Progress" TAB — hides the back button
   *  and leaves room for the floating nav pill (vs the full-screen overlay). */
  @Input() tab = false;
  @ViewChild('scroller') scroller!: ElementRef<HTMLDivElement>;

  private est = inject(EstateService);

  // --- constants (ported from renderVals) ---
  private readonly L = 100000;
  private readonly HOUSES = 9;
  private readonly STAGES_N = 5;
  private readonly TOTAL = this.HOUSES * this.STAGES_N; // 45
  private readonly INCOME = 1500;
  private readonly SIP = 25000;

  private readonly STAGES = [
    { key: 'plot', name: 'The Plot' },
    { key: 'grading', name: 'Levelled Ground' },
    { key: 'foundation', name: 'Foundation' },
    { key: 'steel', name: 'Steel Frame' },
    { key: 'villa', name: 'The Villa' },
  ];

  private readonly ORDER: [number, number][] = [
    [1, 1], [2, 2], [1, 2], [2, 1], [0, 2], [2, 0], [0, 1], [1, 0], [0, 0],
  ];

  private readonly FUNDS = [
    { name: 'Arbitrage', w: 0.36, bar: '#8aa89b', isVault: true, isGold: false, isLarge: false, isMid: false, isSmall: false },
    { name: 'Gold', w: 0.16, bar: '#f6c445', isVault: false, isGold: true, isLarge: false, isMid: false, isSmall: false },
    { name: 'Large cap', w: 0.16, bar: '#4a9d47', isVault: false, isGold: false, isLarge: true, isMid: false, isSmall: false },
    { name: 'Mid cap', w: 0.16, bar: '#5cb85c', isVault: false, isGold: false, isLarge: false, isMid: true, isSmall: false },
    { name: 'Small cap', w: 0.16, bar: '#8fd48a', isVault: false, isGold: false, isLarge: false, isMid: false, isSmall: true },
  ];

  /** The ladder is authored on a 402px frame; on a wider phone we scale the whole
   *  column up to fill the width (capped so it stays phone-shaped on desktop). */
  readonly FRAME = 402;
  readonly frameScale = signal(1);
  private _measureFrame = () => {
    const w = typeof window !== 'undefined' ? window.innerWidth : this.FRAME;
    // fill the viewport up to a comfortable phone cap (~460px), never below 1x
    const target = Math.min(w, 460);
    this.frameScale.set(Math.max(1, target / this.FRAME));
  };

  // board geometry — Home's proportions, shifted right of the rail
  private readonly BW = 54;
  private readonly BH = 31.2;
  private readonly OX = 201;
  private readonly ART_DX = 71;
  private readonly ART_DY = 53.7;
  private readonly VS = this.BW / 93.6;

  // rail section geometry (px)
  private readonly SEC = 754;
  private readonly OFF = 100;
  private readonly RT = 40;
  private readonly RB = this.SEC - 300;      // 454
  private readonly SPAN = this.RB - this.RT; // 414

  // --- villa count-up (0→1 over 1400ms, cubic ease-out) feeding income figures ---
  private readonly count = signal(1);
  private cuRaf = 0;

  // --- viewLevel from scroll (drives HUD earn button + back arrow) ---
  private readonly viewLevel = signal(0);
  private scRaf = 0;

  // --- currency helpers ---
  private inr(n: number): string { return '₹' + n.toLocaleString('en-IN'); }
  private lakh(n: number): string {
    return n >= 100000
      ? '₹' + (n % 100000 ? (n / 100000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(n / 100000)) + 'L'
      : n >= 1000 ? '₹' + Math.round(n / 1000) + 'k' : this.inr(n);
  }

  /** Live worth (₹) from the estate service — everything derives from it. */
  readonly worth = computed(() => Math.max(0, this.est.estateValue));
  /** Current level: 1..45, one past the last fully-crossed lakh. */
  readonly currentLevel = computed(() => Math.min(this.TOTAL, Math.floor(this.worth() / this.L) + 1));

  readonly worthLabel = computed(() => this.lakh(this.worth()));

  /** All 45 rungs, reversed — highest level at the top, ₹0 at the bottom. */
  readonly levels = computed<LevelVM[]>(() => {
    const worth = this.worth();
    const current = this.currentLevel();
    const count = this.count();
    const { BW, BH, OX, ART_DX, ART_DY, VS, L, HOUSES, TOTAL, INCOME } = this;
    const lakh = (n: number) => this.lakh(n);
    const inr = (n: number) => this.inr(n);
    const levels: LevelVM[] = [];

    for (let k = 1; k <= TOTAL; k++) {
      const h = Math.ceil(k / 5), s = (k - 1) % 5, st = this.STAGES[s];
      const threshold = k * L, start = threshold - L;
      const isDone = k < current, isCurrent = k === current, isLocked = k > current;
      const isVilla = s === 4, houseDone = worth >= 5 * h * L;
      const y0 = isVilla ? 56 : 120, boardH = isVilla ? 214 : 330;
      const cellAt = (c: number, r: number) => {
        const cx = OX + (c - r) * BW, cy = y0 + (c + r) * BH;
        return { cx, cy, pts: `${cx},${cy - BH} ${cx + BW},${cy} ${cx},${cy + BH} ${cx - BW},${cy}` };
      };
      const [hc, hr] = this.ORDER[h - 1], hd = hc + hr;
      const before = (c: number, r: number) => (c + r < hd) || (c + r === hd && c < hc);
      const nextIdx = h < HOUSES ? h : -1;
      const [nc, nr] = nextIdx >= 0 ? this.ORDER[nextIdx] : [-1, -1];
      const backCells: (CellVM & { d: number; c: number })[] = [];
      const frontCells: (CellVM & { d: number; c: number })[] = [];
      const backVillas: (VillaVM & { d: number; c: number })[] = [];
      const frontVillas: (VillaVM & { d: number; c: number })[] = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        if (c === hc && r === hr) continue;
        const idx = this.ORDER.findIndex(o => o[0] === c && o[1] === r), p = cellAt(c, r);
        const builtVilla = idx < h - 1;
        if (builtVilla) {
          const v = { tf: `translate(${(p.cx - 120 * VS).toFixed(1)},${(p.cy - 80 * VS).toFixed(1)}) scale(${VS.toFixed(4)})`, d: c + r, c };
          (before(c, r) ? backVillas : frontVillas).push(v);
        } else {
          const isNext = isVilla && houseDone && c === nc && r === nr;
          const cell = { pts: p.pts, d: c + r, c, fill: '#242739', stroke: isNext ? '#9184d9' : '#3f424d', sw: 1.5, dash: '6 5', anim: isNext ? 'mapPulse 2s ease-in-out infinite' : 'none' };
          (before(c, r) ? backCells : frontCells).push(cell);
        }
      }
      const byDepth = (a: { d: number; c: number }, b: { d: number; c: number }) => (a.d - b.d) || (a.c - b.c);
      backCells.sort(byDepth); frontCells.sort(byDepth); backVillas.sort(byDepth); frontVillas.sort(byDepth);
      const hp = cellAt(hc, hr), nx = nextIdx >= 0 ? cellAt(nc, nr) : { cx: 0, cy: 0 };

      levels.push({
        level: k, name: st.name, threshold, isDone, isCurrent, isLocked,
        isPlot: s === 0, isGrading: s === 1, isFoundation: s === 2, isSteel: s === 3, isVilla,
        backCells, frontCells, backVillas, frontVillas, boardVB: `0 0 402 ${boardH}`, tileH: boardH + 'px',
        artLeft: (hp.cx - ART_DX).toFixed(1) + 'px', artTop: (hp.cy - ART_DY).toFixed(1) + 'px',
        nextX: nx.cx, nextY: nx.cy, nextTY: nx.cy + 5, nextDisplay: (isVilla && houseDone && nextIdx >= 0) ? 'block' : 'none',
        mapLabel: `House ${h} of ${HOUSES}` + (isVilla && houseDone ? ' · complete' : isLocked ? '' : ' · building'),
        mapLabelColor: isLocked ? '#6b6e79' : '#b5abfc', boardFilter: isLocked ? 'grayscale(1) brightness(.75)' : 'none',
        sheenAnim: houseDone ? 'sheen 3.2s ease-in-out infinite' : 'none',
        ringAnim: houseDone ? 'ringOut 2.4s ease-out infinite' : 'none',
        ringAnim2: houseDone ? 'ringOut 2.4s ease-out 1.2s infinite' : 'none',
        incomeLabel: '+' + inr(Math.round(INCOME * h * (houseDone ? count : 1))),
        payLocked: !houseDone, housePct: Math.round(Math.max(0, Math.min(1, worth / (5 * h * L))) * 100) + '%',
        paidLabel: lakh(Math.min(worth, 5 * h * L)) + ' in', goalLabel: lakh(5 * h * L),
        payBg: houseDone ? 'linear-gradient(120deg,#4a3b12 0%,#2e2308 55%,#1d1605 100%)' : 'linear-gradient(120deg,#26221a 0%,#1e1b16 60%,#1b1e2c 100%)',
        payShadow: houseDone ? '0 0 0 1.5px #f6c445,0 0 30px rgba(246,196,69,.4)' : '0 0 0 1px #3f3a2c',
        payGlowA: houseDone ? '.4' : '.12', payColor: houseDone ? '#ffe9a3' : '#c9b47a', payTextGlow: houseDone ? '0 0 18px rgba(246,196,69,.6)' : 'none',
        coinFilter: 'none', payFilter: houseDone ? 'none' : 'grayscale(1) brightness(.85)',
        payRight: houseDone ? '1st credit\n5 Oct' : lakh(Math.max(0, 5 * h * L - worth)) + '\nto go',
        burst: houseDone ? [0, 1, 2, 3, 4, 5].map(i => ({ left: (14 + i * 9 + (i % 2) * 5) + 'px', size: (6 + (i % 3) * 2) + 'px', delay: (i * .38).toFixed(2) + 's' })) : [],
        unlockLabel: houseDone ? 'Villa ' + h + ' pays you · credited on the 5th' : 'From villa ' + h,
        unlockAnim: houseDone ? 'unlockIn .7s cubic-bezier(.2,.9,.2,1.1) both, goldPulse 2.6s ease-in-out .7s infinite' : 'none',
        coinAnim: houseDone ? 'coinSpin 2.6s ease-in-out infinite' : 'none',
        milestone: inr(threshold),
        titleColor: isLocked ? '#9a9aa5' : '#e9e9ed',
        titleGlow: isLocked ? 'transparent' : 'rgba(145,132,217,.55)',
        bannerTop: isLocked ? '#232739' : '#4a3f8a', bannerBottom: isLocked ? '#1b1e2c' : '#2f2760',
        pillBorder: isCurrent ? '#5d5294' : '#2b2e3a',
        funds: this.FUNDS.map(fd => ({
          name: fd.name, amount: inr(Math.round(threshold * fd.w)), bar: fd.bar,
          isVault: fd.isVault, isGold: fd.isGold, isLarge: fd.isLarge, isMid: fd.isMid, isSmall: fd.isSmall,
          border: isLocked ? '#2b2e3a' : '#3f424d',
          shadow: isLocked ? 'none' : '0 6px 16px rgba(0,0,0,.35),inset 0 1px 0 rgba(233,233,237,.05)',
        })),
        startLabel: inr(start),
        showStatus: isDone, chipTop: (y0 + 2 * BH) + 'px',
        statusText: isDone ? 'Completed · paid ' + lakh(threshold) : 'In progress · ' + Math.round(Math.max(0, Math.min(1, (worth - start) / L)) * 100) + '%',
        statusBg: isDone ? 'rgba(88,184,88,.14)' : 'rgba(145,132,217,.14)', statusColor: isDone ? '#8fd48f' : '#d2cefd',
        statusBorder: isDone ? 'rgba(88,184,88,.45)' : '#5d5294', statusGlow: isDone ? 'rgba(88,184,88,.25)' : 'rgba(145,132,217,.3)',
        tileFilter: isLocked ? 'grayscale(1) brightness(.7)' : 'none', tileOpacity: isLocked ? 0.75 : 1,
        isTop: k === TOTAL, hasAbove: k < TOTAL,
        above: k + 1, aboveName: k < TOTAL ? this.STAGES[k % 5].name : '',
      });
    }
    levels.reverse();
    return levels;
  });

  // --- rail geometry (ported from yFor / railMarks) ---
  private yFor(v: number): number {
    const vv = Math.min(this.TOTAL * this.L, Math.max(0, v));
    const n = Math.min(this.TOTAL, Math.floor(vv / this.L) + 1);
    const fr = (vv - (n - 1) * this.L) / this.L;
    return this.OFF + (this.TOTAL - n) * this.SEC + this.RB - fr * this.SPAN;
  }

  readonly fillTop = computed(() => Math.round(this.yFor(this.worth())) + 'px');
  readonly railTop = this.RT + 'px';
  readonly railH = (this.OFF + this.TOTAL * this.SEC) + 'px';

  /** Checkpoint nodes: villa completions (₹5L … ₹45L) plus the ₹0 base dot. */
  readonly railMarks = computed<RailMark[]>(() => {
    const worth = this.worth();
    const marks: RailMark[] = [];
    // a checkpoint for EVERY level (k = 1..45), placed at that level's threshold on
    // the rail. Villa completions (k % 5 === 0) are the big, labelled milestones;
    // the other levels get a small dot so progress reads off the bar at a glance.
    for (let k = this.TOTAL; k >= 1; k--) {
      const top = this.OFF + (this.TOTAL - k) * this.SEC + this.RT, v = k * this.L;
      const reached = v <= worth;
      const isVilla = k % 5 === 0;
      if (isVilla) {
        const h = k / 5;
        marks.push({
          top: top + 'px', size: '20px', reached, isFlag: !reached, flagFill: reached ? '#8fd48f' : '#6b6e79',
          bg: reached ? '#8fd48f' : '#232634',
          glow: reached ? '0 0 12px rgba(88,184,88,.5)' : 'inset 0 0 0 1.5px #3f424d',
          color: reached ? '#8fd48f' : '#6b6e79',
          tagBg: reached ? 'rgba(88,184,88,.12)' : 'transparent',
          label: 'Villa ' + h + ' · ' + this.lakh(v), isTick: false,
        });
      } else {
        // a small per-level dot (no label) — reached ones glow accent, ahead ones dim
        marks.push({
          top: top + 'px', size: '8px', reached, isFlag: false, flagFill: '#6b6e79',
          bg: reached ? '#b5abfc' : '#3f424d',
          glow: reached ? '0 0 6px rgba(145,132,217,.5)' : 'none',
          color: '#6b6e79', tagBg: 'transparent', label: '', isTick: true,
        });
      }
    }
    marks.push({
      top: (this.OFF + (this.TOTAL - 1) * this.SEC + this.RB) + 'px', size: '14px', reached: false,
      isFlag: false, flagFill: '#6b6e79', bg: '#d2cefd', glow: 'none', color: '#c9c6da', tagBg: 'transparent', label: '₹0', isTick: false,
    });
    return marks;
  });

  // --- HUD earn button (targets the next villa above the level on screen) ---
  private earnTarget = 0;
  private readonly viewOrCurrent = computed(() => this.viewLevel() || this.currentLevel());

  readonly earnLabel = computed(() => {
    const viewLevel = this.viewOrCurrent();
    const viewHouse = viewLevel % 5 === 0 ? Math.floor(viewLevel / 5) + 1 : Math.ceil(viewLevel / 5);
    const earnHouse = Math.min(this.HOUSES, viewHouse);
    const earnDone = viewLevel % 5 === 0 && viewLevel === this.TOTAL;
    this.earnTarget = earnDone ? 0 : earnHouse * 5;
    return earnDone ? 'Estate complete' : 'Earn ' + this.inr(this.INCOME * earnHouse) + '/mo';
  });
  readonly earnOpacity = computed(() => (this.viewOrCurrent() % 5 === 0 && this.viewOrCurrent() === this.TOTAL) ? .6 : 1);

  readonly showBack = computed(() => this.viewOrCurrent() !== this.currentLevel());
  readonly backRot = computed(() => this.viewOrCurrent() > this.currentLevel() ? '0deg' : '180deg');

  // --- interactions ---
  ngAfterViewInit(): void {
    this._measureFrame();
    if (typeof window !== 'undefined') window.addEventListener('resize', this._measureFrame);
    const el = this.scroller?.nativeElement;
    if (!el) return;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    this.toCurrent();
    this.countUp();
  }

  private onScroll = (): void => {
    if (this.scRaf) return;
    this.scRaf = requestAnimationFrame(() => {
      this.scRaf = 0;
      const el = this.scroller?.nativeElement;
      if (!el) return;
      // scrollTop is in the zoom-scaled space, so scale the section metrics too
      const z = this.frameScale();
      const v = Math.max(1, Math.min(this.TOTAL, this.TOTAL - Math.round((el.scrollTop - 100 * z) / (this.SEC * z))));
      if (v !== this.viewLevel()) this.viewLevel.set(v);
    });
  };

  private scrollToLevel(lv: number, smooth: boolean): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    const sec = el.querySelector<HTMLElement>('section[data-level="' + lv + '"]');
    if (!sec) return;
    if (smooth) el.scrollTo({ top: sec.offsetTop, behavior: 'smooth' });
    else el.scrollTop = sec.offsetTop;
  }

  private toCurrent(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    const go = () => {
      const sec = el.querySelector<HTMLElement>('section[data-current="true"]');
      el.scrollTop = sec ? sec.offsetTop : el.scrollHeight;
    };
    go();
    requestAnimationFrame(go);
    setTimeout(go, 150);
  }

  private countUp(): void {
    cancelAnimationFrame(this.cuRaf);
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1400);
      this.count.set(1 - Math.pow(1 - p, 3));
      if (p < 1) this.cuRaf = requestAnimationFrame(step);
    };
    this.cuRaf = requestAnimationFrame(step);
  }

  /** HUD "Earn" tap → smooth-scroll to that villa card. */
  jumpToVilla(): void { if (this.earnTarget) this.scrollToLevel(this.earnTarget, true); }
  /** Bottom-right arrow → smooth-scroll back to the current level. */
  backToCurrent(): void { this.scrollToLevel(this.currentLevel(), true); }

  onBack(): void { this.back.emit(); }

  trackLevel(_i: number, lv: LevelVM): number { return lv.level; }
  trackMark(i: number, _m: RailMark): number { return i; }
  trackFund(_i: number, f: FundVM): string { return f.name; }
  trackCell(i: number, _c: CellVM): number { return i; }
  trackVilla(i: number, _v: VillaVM): number { return i; }
  trackBurst(i: number, _b: BurstVM): number { return i; }
}
