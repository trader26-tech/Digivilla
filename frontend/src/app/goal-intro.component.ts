import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { GoalPreset } from './models';

/**
 * The single screen shown after a goal is picked (merges the old intro + amount
 * screens). A short animated "why" line explains the goal and its rule of thumb,
 * then a tiny per-goal calculator turns ONE input (monthly expenses, home price,
 * guests…) into the amount to save. Continue emits that amount to the timing step.
 */
@Component({
  selector: 'app-goal-intro',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './goal-intro.component.html',
  styleUrl: './goal-intro.component.scss',
})
export class GoalIntroComponent implements OnInit, OnDestroy {
  @Input({ required: true }) goal!: GoalPreset;
  /** Emits the chosen amount to carry to the timing screen. */
  @Output() amountReady = new EventEmitter<number>();
  @Output() back = new EventEmitter<void>();

  cfg!: IntroConfig;
  input = 0; // the single calculator input value
  entered = false;
  popKey = 0; // bumped on each change so the result number can re-pop

  /** Two-phase reveal: 'why' shows the big centred text, then 'calc' shrinks it
   *  up and reveals the slider + input. Auto-advances once words finish. */
  phase: 'why' | 'calc' = 'why';

  // slider track for the input value
  readonly TRACK = 1000;
  sliderPos = 500;
  inMin = 0;
  inMax = 0;

  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.cfg = INTRO[this.goal.key] ?? fallbackConfig(this.goal);
    this.input = this.cfg.defaultInput;
    this.setupInputRange();
    setTimeout(() => (this.entered = true), 20);
    // After the words have faded in, glide into the calculator phase.
    const wordCount = this.whyWords.length;
    const hold = 120 + wordCount * 55 + 900; // last word delay + read beat
    this.timer = setTimeout(() => this.reveal(), hold);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Skip the hold and reveal the calculator immediately (tap anywhere). */
  reveal(): void {
    if (this.phase === 'calc') return;
    if (this.timer) clearTimeout(this.timer);
    this.phase = 'calc';
  }

  get hue(): number {
    return this.cfg.hue;
  }

  /** The "why" line split into words, for a staggered fade-in animation. */
  get whyWords(): string[] {
    return this.cfg.why.split(' ');
  }

  /** Live recommended amount from the current input. Never zero. */
  get recommended(): number {
    const raw = this.cfg.compute(this.input || 0);
    return Math.max(this.cfg.floor, Math.round(raw));
  }

  // ---- input range + slider (exponential, like the timing screen) ----
  private setupInputRange(): void {
    const d = this.cfg.defaultInput || 1;
    // Counts (guests/people/travellers) use a small linear-ish band; money uses
    // a wide exponential band so both ends are easy to reach.
    if (this.cfg.inputPrefix) {
      this.inMin = Math.max(this.cfg.inputStep, Math.round(d * 0.2));
      this.inMax = Math.round(d * 4);
    } else {
      this.inMin = 1;
      this.inMax = Math.max(10, d * 4);
    }
    this.sliderPos = this.inputToPos(this.input);
  }
  private posToInput(pos: number): number {
    const t = Math.max(0, Math.min(1, pos / this.TRACK));
    const raw = this.inMin * Math.pow(this.inMax / this.inMin, t);
    return this.snap(raw);
  }
  private inputToPos(v: number): number {
    const a = Math.max(this.inMin, Math.min(this.inMax, v || this.inMin));
    const t = Math.log(a / this.inMin) / Math.log(this.inMax / this.inMin || 1);
    return Math.round(t * this.TRACK);
  }
  private snap(v: number): number {
    const s = this.cfg.inputStep;
    return Math.max(this.inMin, Math.min(this.inMax, Math.round(v / s) * s));
  }
  get sliderFrac(): number {
    return this.sliderPos / this.TRACK;
  }
  onSlide(v: string): void {
    this.sliderPos = Number(v);
    this.input = this.posToInput(this.sliderPos);
    this.popKey++;
    if (navigator.vibrate) navigator.vibrate(2);
  }

  stepInput(dir: number): void {
    this.input = this.snap(this.input + dir * this.cfg.inputStep);
    this.sliderPos = this.inputToPos(this.input);
    this.popKey++;
    if (navigator.vibrate) navigator.vibrate(4);
  }

  onInputText(v: string): void {
    const n = parseInt((v || '').replace(/[^0-9]/g, ''), 10);
    this.input = isNaN(n) ? 0 : n;
    if (this.input > this.inMax) this.inMax = Math.round(this.input * 1.25);
    this.sliderPos = this.inputToPos(this.input);
    this.popKey++;
  }

  get inputDisplay(): string {
    return this.input ? this.input.toLocaleString('en-IN') : '';
  }

  compactInr(v: number): string {
    if (v >= 10_000_000) {
      const cr = v / 10_000_000;
      return `₹${cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')} Cr`;
    }
    if (v >= 100_000) {
      const l = v / 100_000;
      return `₹${l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')} L`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  goBack(): void {
    this.back.emit();
  }

  /** Continue -> carry the amount forward. Nothing is "saved" here — that only
   *  happens at the very end of the flow. */
  continue(): void {
    if (navigator.vibrate) navigator.vibrate(8);
    this.amountReady.emit(this.recommended);
  }
}

interface IntroConfig {
  hue: number;
  why: string; // the animated "why" line (goal + rule of thumb)
  inputLabel: string; // e.g. "Your monthly expenses"
  inputPrefix: string; // "₹" or "" (for counts)
  inputSuffix: string; // "" or " guests"
  inputStep: number;
  defaultInput: number;
  ruleText: string; // the calculation rule, shown small e.g. "× 6 months"
  floor: number; // minimum recommended amount
  compute: (x: number) => number; // input -> recommended amount
  // Legacy fields kept optional so existing config entries still type-check.
  tagline?: string;
  rupiSays?: string;
  rupiPose?: string;
  hero?: string;
}

/** Per-goal configuration. Hues match the picker/knob so colour is coherent. */
const INTRO: Record<string, IntroConfig> = {
  emergency: {
    hue: 190,
    tagline: 'Your safety net for life’s surprises.',
    why: "Life happens — a surprise bill, a job change. Don't worry, we'll help you build a cushion so you're always ready.",
    rupiSays: "Life throws curveballs — this keeps a bad day from becoming a bad year.",
    rupiPose: 'point',
    hero: 'shield',
    inputLabel: 'Your monthly expenses',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 5_000,
    defaultInput: 50_000,
    ruleText: '× 6 months of expenses',
    floor: 100_000,
    compute: (x) => x * 6,
  },
  health: {
    hue: 356,
    tagline: 'A cushion for medical surprises.',
    why: "A health scare is stressful enough. We'll help you keep money set aside so the bills never add to the worry.",
    rupiSays: "A hospital bill shouldn't hurt twice. Let's keep a cushion ready.",
    rupiPose: 'think',
    hero: 'heart',
    inputLabel: 'People in your family',
    inputPrefix: '',
    inputSuffix: '',
    inputStep: 1,
    defaultInput: 4,
    ruleText: '≈ ₹5 L cushion per person',
    floor: 300_000,
    compute: (x) => x * 500_000,
  },
  car: {
    hue: 205,
    tagline: 'The car you’ve been picturing.',
    why: "Dreaming of your own car? We'll help you save up so it's fully yours — no years of heavy EMIs.",
    rupiSays: "Save up and skip the EMI — the car's nicer when it's fully yours!",
    rupiPose: 'happy',
    hero: 'car',
    inputLabel: 'The car’s on-road price',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 100_000,
    defaultInput: 1_500_000,
    ruleText: 'the full price you aim for',
    floor: 200_000,
    compute: (x) => x,
  },
  wedding: {
    hue: 330,
    tagline: 'A celebration, not a debt.',
    why: "Planning the big day? We'll help you save for it calmly, so the celebration never becomes a debt.",
    rupiSays: "Big day, zero debt hangover. Let's plan it right.",
    rupiPose: 'cheer',
    hero: 'rings',
    inputLabel: 'Number of guests',
    inputPrefix: '',
    inputSuffix: '',
    inputStep: 25,
    defaultInput: 300,
    ruleText: '≈ ₹8,000 per guest, all in',
    floor: 500_000,
    compute: (x) => x * 8_000,
  },
  vacation: {
    hue: 25,
    tagline: 'The trip you keep talking about.',
    why: "That trip you keep dreaming of? We'll help you set a little aside each month and turn “someday” into a date.",
    rupiSays: "“Someday” becomes a date once you start setting aside a little.",
    rupiPose: 'happy',
    hero: 'plane',
    inputLabel: 'Travellers',
    inputPrefix: '',
    inputSuffix: '',
    inputStep: 1,
    defaultInput: 2,
    ruleText: '≈ ₹1.5 L per traveller',
    floor: 100_000,
    compute: (x) => x * 150_000,
  },
  gadget: {
    hue: 262,
    tagline: 'That thing you want — planned, not on EMI.',
    why: "Got your eye on something? We'll help you save up and buy it outright — no interest, no EMI.",
    rupiSays: "Buy it outright, skip the interest. Smart move!",
    rupiPose: 'happy',
    hero: 'sparkle',
    inputLabel: 'Its price',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 10_000,
    defaultInput: 200_000,
    ruleText: 'the price you aim for',
    floor: 20_000,
    compute: (x) => x,
  },
  house: {
    hue: 222,
    tagline: 'The keys to your own place.',
    why: "Ready for your own place? We'll help you save the down payment, one comfortable step at a time.",
    rupiSays: "Aim for the 20% down payment — the loan covers the rest.",
    rupiPose: 'point',
    hero: 'house',
    inputLabel: 'The home’s price',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 500_000,
    defaultInput: 8_000_000,
    ruleText: '× 20% down payment',
    floor: 500_000,
    compute: (x) => x * 0.2,
  },
  child_education: {
    hue: 268,
    tagline: 'Their future, funded on time.',
    why: "Their future matters. Start early and we'll help you fund it fully — no last-minute loans.",
    rupiSays: "Start early and college never means a last-minute loan.",
    rupiPose: 'think',
    hero: 'grad',
    inputLabel: 'Course cost today',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 250_000,
    defaultInput: 2_500_000,
    ruleText: '≈ 2× for future inflation',
    floor: 500_000,
    compute: (x) => x * 2,
  },
  retirement: {
    hue: 28,
    tagline: 'The freedom to stop working.',
    why: "Picture life after work. We'll help you build a corpus that keeps paying your bills, long after your salary stops.",
    rupiSays: "Build a corpus that pays your bills after the salary stops.",
    rupiPose: 'point',
    hero: 'palm',
    inputLabel: 'Monthly expenses you’ll want',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 10_000,
    defaultInput: 60_000,
    ruleText: '× 300 (25 years of living)',
    floor: 2_000_000,
    compute: (x) => x * 300,
  },
  wealth: {
    hue: 150,
    tagline: 'Money that grows while you live.',
    why: "No deadline, no pressure. We'll help your money grow quietly in the background, year after year.",
    rupiSays: "No deadline here — just steady compounding doing its magic.",
    rupiPose: 'cheer',
    hero: 'growth',
    inputLabel: 'Monthly you can invest',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 5_000,
    defaultInput: 25_000,
    ruleText: '× 12 months × 20 years, grown',
    floor: 1_000_000,
    compute: (x) => x * 12 * 20 * 2, // rough 2x growth over 20y of SIP
  },
};

function fallbackConfig(goal: GoalPreset): IntroConfig {
  return {
    hue: 222,
    tagline: goal.blurb || 'A goal worth planning for.',
    why: "Whatever the goal, we'll help you get there with a steady, stress-free monthly plan.",
    rupiSays: "A little each month and we'll get you there — I'll help!",
    rupiPose: 'happy',
    hero: 'sparkle',
    inputLabel: 'Target amount',
    inputPrefix: '₹',
    inputSuffix: '',
    inputStep: 100_000,
    defaultInput: goal.default_amount || 500_000,
    ruleText: 'the amount you aim for',
    floor: 50_000,
    compute: (x) => x,
  };
}
