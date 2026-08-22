import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { GoalPreset } from './models';
import { RupiComponent, RupiPose } from './rupi.component';

/**
 * The screen shown right after a goal is picked, before the amount knob.
 *
 * Rupi (the ₹ mascot) greets the user and explains — in one short line — why
 * this goal matters, so there's almost no text to read. A tiny per-goal
 * "calculator" turns ONE simple input (monthly expenses, home price, guests…)
 * into a recommended amount, which is emitted as the preset for the knob screen.
 */
@Component({
  selector: 'app-goal-intro',
  standalone: true,
  imports: [CommonModule, FormsModule, RupiComponent],
  templateUrl: './goal-intro.component.html',
  styleUrl: './goal-intro.component.scss',
})
export class GoalIntroComponent implements OnInit {
  @Input({ required: true }) goal!: GoalPreset;
  /** Emits the recommended amount to preset on the knob. */
  @Output() amountReady = new EventEmitter<number>();
  @Output() back = new EventEmitter<void>();

  cfg!: IntroConfig;
  input = 0; // the single calculator input value
  entered = false;

  ngOnInit(): void {
    this.cfg = INTRO[this.goal.key] ?? fallbackConfig(this.goal);
    this.input = this.cfg.defaultInput;
    setTimeout(() => (this.entered = true), 20);
  }

  get hue(): number {
    return this.cfg.hue;
  }

  /** Live recommended amount from the current input. Never zero. */
  get recommended(): number {
    const raw = this.cfg.compute(this.input || 0);
    return Math.max(this.cfg.floor, Math.round(raw));
  }

  stepInput(dir: number): void {
    this.input = Math.max(0, this.input + dir * this.cfg.inputStep);
  }

  onInputText(v: string): void {
    const n = parseInt((v || '').replace(/[^0-9]/g, ''), 10);
    this.input = isNaN(n) ? 0 : n;
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

  /** What Rupi "says" — short, warm, goal-specific. */
  get rupiSays(): string {
    return this.cfg.rupiSays;
  }
  get rupiPose(): RupiPose {
    return this.cfg.rupiPose ?? 'point';
  }

  goBack(): void {
    this.back.emit();
  }

  continue(): void {
    if (navigator.vibrate) navigator.vibrate(8);
    this.amountReady.emit(this.recommended);
  }
}

interface IntroConfig {
  hue: number;
  tagline: string; // one-liner: what it is
  why: string; // one-liner: why it matters (legacy — no longer shown)
  rupiSays: string; // Rupi's short spoken line (replaces the paragraph)
  rupiPose?: RupiPose;
  hero: string; // svg id rendered by the template switch
  inputLabel: string; // e.g. "Your monthly expenses"
  inputPrefix: string; // "₹" or "" (for counts)
  inputSuffix: string; // "" or " guests"
  inputStep: number;
  defaultInput: number;
  ruleText: string; // the calculation rule, shown small e.g. "× 6 months"
  floor: number; // minimum recommended amount
  compute: (x: number) => number; // input -> recommended amount
}

/** Per-goal configuration. Hues match the picker/knob so colour is coherent. */
const INTRO: Record<string, IntroConfig> = {
  emergency: {
    hue: 190,
    tagline: 'Your safety net for life’s surprises.',
    why: 'Job loss, repairs, a medical bill — this keeps them from becoming a crisis.',
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
    why: 'So a hospital bill is never a financial shock on top of a health one.',
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
    why: 'Save for it instead of carrying an expensive EMI for years.',
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
    why: 'Plan the big day so it doesn’t derail your other goals.',
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
    why: 'A little set aside each month turns “someday” into a date.',
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
    why: 'Buy it outright and skip the interest.',
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
    why: 'Aim for a 20% down payment — the rest is your home loan.',
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
    why: 'Start early so college never means a last-minute loan.',
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
    why: 'Build a corpus that pays your bills when your salary stops.',
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
    why: 'No fixed deadline — just steady, long-term compounding.',
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
    why: 'A steady monthly plan gets you there.',
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
