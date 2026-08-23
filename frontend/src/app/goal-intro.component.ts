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

  /** The "why this fund" welcome plays as a full-screen moment showing the
   *  reasons; the user taps a button to enter the calculator. `phase` is 'why'
   *  while it shows, 'calc' once dismissed. whyShown fades the title + points in;
   *  ctaShown reveals the button; whyLeaving fades the overlay out on tap. */
  phase: 'why' | 'calc' = 'why';
  whyShown = false;
  ctaShown = false;
  whyLeaving = false;

  // slider track for the input value
  readonly TRACK = 1000;
  sliderPos = 500;
  inMin = 0;
  inMax = 0;

  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    this.cfg = INTRO[this.goal.key] ?? fallbackConfig(this.goal);
    this.input = this.cfg.defaultInput;
    this.setupInputRange();
    this.timers.push(setTimeout(() => (this.entered = true), 20));
    // Stagger the welcome in: title + points, then the button. No auto-dismiss.
    this.timers.push(setTimeout(() => (this.whyShown = true), 80));
    const pts = this.detail.points.length;
    const afterPoints = 350 + pts * 260 + 250;
    this.timers.push(setTimeout(() => (this.ctaShown = true), afterPoints));
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** User tapped the welcome button -> fade the overlay out, reveal calculator. */
  reveal(): void {
    if (this.phase === 'calc' || this.whyLeaving) return;
    if (navigator.vibrate) navigator.vibrate(8);
    this.whyLeaving = true;
    this.timers.push(setTimeout(() => (this.phase = 'calc'), 450));
  }

  get hue(): number {
    return this.cfg.hue;
  }

  get detail(): DetailContent {
    return this.cfg.detail || fallbackDetail(this.goal);
  }

  /** Reassuring CTA label for the welcome screen. */
  get ctaLabel(): string {
    return this.cfg.reassure ? 'Got it — let’s go' : 'Let’s go';
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

  /** Continue -> carry the amount forward to the timing (date) screen. Nothing
   *  is "saved" here — that only happens at the very end of the flow. */
  continue(): void {
    if (navigator.vibrate) navigator.vibrate(8);
    this.amountReady.emit(this.recommended);
  }
}

interface DetailPoint {
  icon: string; // svg id rendered by the sheet's switch
  text: string; // short, clear line
}
interface DetailContent {
  title: string; // e.g. "Why an emergency fund?"
  points: DetailPoint[]; // 3 short reasons
}

interface IntroConfig {
  hue: number;
  why: string; // fallback welcome line (used if `hook` is absent)
  hook?: string; // the short welcome line, e.g. "Life happens — a surprise bill…"
  reassure?: string; // the reassuring line under it, e.g. "Don't worry — we've got you."
  detail?: DetailContent; // the "Why this fund?" sheet content
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

function fallbackDetail(goal: GoalPreset): DetailContent {
  return {
    title: `Why plan for ${goal.label.toLowerCase()}?`,
    points: [
      { icon: 'target', text: 'A clear target keeps you on track.' },
      { icon: 'growth', text: 'Investing beats letting it sit idle.' },
      { icon: 'shield', text: 'A steady monthly plan makes it painless.' },
    ],
  };
}

/** Per-goal configuration. Hues match the picker/knob so colour is coherent. */
const INTRO: Record<string, IntroConfig> = {
  emergency: {
    hue: 190,
    hook: 'Life happens — a surprise bill, a sudden job change.',
    reassure: "Don't worry, we've got you. Let's build a cushion so you're always ready.",
    detail: {
      title: 'Why an emergency fund?',
      points: [
        { icon: 'shield', text: '6 months of expenses covers a job gap or a big surprise bill.' },
        { icon: 'water', text: 'Kept in liquid funds — safe and available within a day.' },
        { icon: 'calm', text: 'Low-risk, not for growth. It’s peace of mind, not a bet.' },
      ],
    },
    why: "Life happens — a surprise bill, a job change. Don't worry, we'll help you build a cushion so you're always ready.",
    tagline: 'Your safety net for life’s surprises.',
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
    hook: "A health scare is hard enough — the bills shouldn't be too.",
    reassure: "Don't worry, we've got you. Let's set aside a cushion just in case.",
    detail: {
      title: "Why a health cushion?",
      points: [
        { icon: 'shield', text: "Covers big medical bills your insurance may not fully cover." },
        { icon: 'water', text: "Kept liquid so it's ready the moment you need it." },
        { icon: 'calm', text: "Peace of mind — one less thing to worry about in a crisis." },
      ],
    },
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
    hook: "Dreaming of your own car?",
    reassure: "We've got you. Save up and skip the years of heavy EMIs.",
    detail: {
      title: "Why save for a car?",
      points: [
        { icon: 'coins', text: "Paying upfront avoids interest — the car costs you less overall." },
        { icon: 'clock', text: "A 3–4 year plan makes a big purchase feel easy." },
        { icon: 'growth', text: "Your money grows while you save, instead of sitting idle." },
      ],
    },
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
    hook: "Planning the big day?",
    reassure: "Don't worry, we've got you. Let's fund it calmly — no debt hangover.",
    detail: {
      title: "Why plan for a wedding?",
      points: [
        { icon: 'coins', text: "A clear budget keeps the celebration from becoming a loan." },
        { icon: 'clock', text: "Saving over a few years beats a last-minute scramble." },
        { icon: 'growth', text: "Invested savings grow, so you need to set aside less each month." },
      ],
    },
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
    hook: "That trip you keep dreaming about?",
    reassure: "We've got you. A little each month turns “someday” into a date.",
    detail: {
      title: "Why plan for the trip?",
      points: [
        { icon: 'target', text: "A set target makes the dream trip actually happen." },
        { icon: 'clock', text: "Short, steady saving beats putting it on a credit card." },
        { icon: 'growth', text: "Your travel fund grows quietly in the background." },
      ],
    },
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
    hook: "Got your eye on something?",
    reassure: "We've got you. Save up and buy it outright — no EMI, no interest.",
    detail: {
      title: "Why save for it?",
      points: [
        { icon: 'coins', text: "Buying outright skips the interest an EMI would add." },
        { icon: 'clock', text: "A short savings plan makes it painless." },
        { icon: 'growth', text: "Money set aside earns a little on the way there." },
      ],
    },
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
    hook: "Ready for a place of your own?",
    reassure: "Don't worry, we've got you. Let's build the down payment, step by step.",
    detail: {
      title: "Why save the down payment?",
      points: [
        { icon: 'target', text: "20% down means a smaller loan and lower EMIs later." },
        { icon: 'clock', text: "A multi-year plan makes a big number feel reachable." },
        { icon: 'growth', text: "Invested savings grow, so you reach the goal faster." },
      ],
    },
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
    hook: "Their future matters to you.",
    reassure: "We've got you. Start early and fund it fully — no last-minute loans.",
    detail: {
      title: "Why start early?",
      points: [
        { icon: 'clock', text: "Starting early means small amounts grow into a lot." },
        { icon: 'growth', text: "Compounding does the heavy lifting over 10+ years." },
        { icon: 'target', text: "We plan for future inflation, so the amount is realistic." },
      ],
    },
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
    hook: "Picture life after work.",
    reassure: "We've got you. Let's build a corpus that keeps paying your bills.",
    detail: {
      title: "Why plan for retirement?",
      points: [
        { icon: 'clock', text: "The earlier you start, the less you need to save monthly." },
        { icon: 'growth', text: "Decades of compounding turn steady savings into a large corpus." },
        { icon: 'target', text: "We size it to fund ~25 years of your living costs." },
      ],
    },
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
    hook: "No deadline, no pressure.",
    reassure: "We've got you. Let's grow your money quietly in the background.",
    detail: {
      title: "Why grow wealth?",
      points: [
        { icon: 'growth', text: "Long-term investing beats letting cash lose value to inflation." },
        { icon: 'clock', text: "Time in the market matters more than timing it." },
        { icon: 'coins', text: "Small, regular investments add up to serious wealth." },
      ],
    },
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
