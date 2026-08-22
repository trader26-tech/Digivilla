import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  OnInit,
  Output,
} from '@angular/core';

import { GoalPreset } from './models';
import { PlannerService } from './planner.service';

/** A titled group of goals rendered as one section in the picker. */
export interface GoalSection {
  category: string; // long | short | protect
  title: string;
  subtitle: string;
  goals: GoalPreset[];
}

/**
 * The app's true first screen — shown before any login.
 *
 * A grid of life goals, split into meaningful sections (Protect / Short-term /
 * Long-term). Tapping a goal card goes STRAIGHT to the "choose amount" screen —
 * no intermediate detail sheet. Short-term goals are parked in liquid funds,
 * which the card notes so the intent is clear.
 */
@Component({
  selector: 'app-goal-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goal-picker.component.html',
  styleUrl: './goal-picker.component.scss',
})
export class GoalPickerComponent implements OnInit {
  /** Emitted the moment a goal card is tapped -> advance to the amount screen. */
  @Output() goalChosen = new EventEmitter<GoalPreset>();

  goals: GoalPreset[] = [];
  loading = true;
  errored = false;

  constructor(private api: PlannerService) {}

  ngOnInit(): void {
    this.api.presets().subscribe({
      next: (g) => {
        this.goals = g;
        this.loading = false;
      },
      error: () => {
        // Fall back to the built-in preset set so the first screen is never
        // empty even if the API is unreachable (offline PWA launch).
        this.goals = FALLBACK_PRESETS;
        this.loading = false;
        this.errored = true;
      },
    });
  }

  /** Goals grouped into ordered sections; empty sections are dropped. */
  get sections(): GoalSection[] {
    return SECTION_META.map((m) => ({
      ...m,
      goals: this.goals.filter((g) => (g.category || 'long') === m.category),
    })).filter((s) => s.goals.length > 0);
  }

  /** Tapping a card immediately advances to the amount screen. */
  choose(g: GoalPreset): void {
    this.goalChosen.emit(g);
  }

  /** Running index across all sections so entrance stagger stays continuous. */
  cardIndex(sectionIdx: number, goalIdx: number): number {
    let n = goalIdx;
    for (let i = 0; i < sectionIdx; i++) n += this.sections[i].goals.length;
    return n;
  }

  /** trackBy so re-renders don't restart card entrance animations. */
  trackByKey(_: number, g: GoalPreset): string {
    return g.key;
  }
  trackBySection(_: number, s: GoalSection): string {
    return s.category;
  }

  /** Compact INR label for a suggested amount, e.g. ₹2 Cr, ₹50 L. */
  compactInr(v: number): string {
    if (v >= 10_000_000) {
      const cr = v / 10_000_000;
      return `₹${cr % 1 === 0 ? cr : cr.toFixed(1)} Cr`;
    }
    if (v >= 100_000) {
      const l = v / 100_000;
      return `₹${l % 1 === 0 ? l : l.toFixed(1)} L`;
    }
    return `₹${v.toLocaleString('en-IN')}`;
  }

  riskLabel(risk: string): string {
    return (
      {
        conservative: 'Steady',
        balanced: 'Balanced',
        aggressive: 'Growth',
      }[risk] ?? risk
    );
  }

  /**
   * A named custom SVG glyph per goal key. Emoji render inconsistently across
   * Android/iOS/desktop; hand-drawn icons keep the first screen on-brand.
   * Unknown keys fall back to a target icon.
   */
  iconOf(key: string): string {
    return ICON_KEYS[key] ?? 'target';
  }

  /** Accent hue (in degrees) used to tint each goal's card. */
  hueOf(key: string): number {
    return HUE_OF[key] ?? 222;
  }
}

/** Ordered section definitions. Protect first (the safety net comes before
 *  everything), then near-term goals, then the long-horizon pillars. */
const SECTION_META: Omit<GoalSection, 'goals'>[] = [
  {
    category: 'protect',
    title: 'Protect',
    subtitle: 'Your safety net — build this first',
  },
  {
    category: 'short',
    title: 'Short-term',
    subtitle: 'Within a few years · kept in liquid funds',
  },
  {
    category: 'long',
    title: 'Long-term',
    subtitle: 'Big life goals that grow over time',
  },
];

/** Map preset key -> icon id rendered by the template's <ng-container> switch. */
const ICON_KEYS: Record<string, string> = {
  retirement: 'retirement',
  child_education: 'education',
  house: 'house',
  car: 'car',
  wealth: 'wealth',
  emergency: 'emergency',
  wedding: 'wedding',
  vacation: 'vacation',
};

/** Per-goal accent hue so the grid reads as a colourful, coherent system. */
const HUE_OF: Record<string, number> = {
  retirement: 28, // warm amber — a sunset/beach retirement
  child_education: 262, // violet
  house: 222, // brand blue
  car: 190, // teal
  wealth: 150, // green — growth
  emergency: 356, // red — safety
  wedding: 330, // pink
  vacation: 205, // sky blue
};

/** Offline fallback mirroring backend/app/presets.py. */
const FALLBACK_PRESETS: GoalPreset[] = [
  {
    key: 'retirement',
    label: 'Retirement',
    icon: '🏖️',
    default_amount: 20_000_000,
    suggested_amounts: [10_000_000, 20_000_000, 50_000_000, 100_000_000],
    default_years: 25,
    default_risk: 'aggressive',
    blurb: 'Build a corpus that funds your lifestyle after you stop working.',
    category: 'long',
  },
  {
    key: 'child_education',
    label: "Child's Education",
    icon: '🎓',
    default_amount: 5_000_000,
    suggested_amounts: [2_500_000, 5_000_000, 8_000_000, 15_000_000],
    default_years: 15,
    default_risk: 'balanced',
    blurb: 'Fund school, college or higher education without last-minute loans.',
    category: 'long',
  },
  {
    key: 'house',
    label: 'Buy a House',
    icon: '🏠',
    default_amount: 8_000_000,
    suggested_amounts: [3_000_000, 5_000_000, 8_000_000, 15_000_000],
    default_years: 8,
    default_risk: 'balanced',
    blurb: 'Save for a down payment or the full value of a home.',
    category: 'long',
  },
  {
    key: 'car',
    label: 'Buy a Car',
    icon: '🚗',
    default_amount: 1_500_000,
    suggested_amounts: [800_000, 1_500_000, 2_500_000, 4_000_000],
    default_years: 4,
    default_risk: 'conservative',
    blurb: 'Plan a big-ticket purchase over the next few years.',
    category: 'short',
    liquid: true,
  },
  {
    key: 'wealth',
    label: 'Grow Wealth',
    icon: '📈',
    default_amount: 10_000_000,
    suggested_amounts: [5_000_000, 10_000_000, 25_000_000, 50_000_000],
    default_years: 15,
    default_risk: 'aggressive',
    blurb: 'Long-term wealth creation with no single fixed target date.',
    category: 'long',
  },
  {
    key: 'emergency',
    label: 'Emergency Fund',
    icon: '🛟',
    default_amount: 600_000,
    suggested_amounts: [300_000, 600_000, 1_000_000, 1_500_000],
    default_years: 2,
    default_risk: 'conservative',
    blurb: 'A safety net of 6-12 months of expenses, kept low-risk and liquid.',
    category: 'protect',
    liquid: true,
  },
  {
    key: 'wedding',
    label: 'Wedding',
    icon: '💍',
    default_amount: 3_000_000,
    suggested_amounts: [1_500_000, 3_000_000, 5_000_000, 8_000_000],
    default_years: 5,
    default_risk: 'balanced',
    blurb: 'Plan for wedding expenses without derailing other goals.',
    category: 'short',
    liquid: true,
  },
  {
    key: 'vacation',
    label: 'Dream Vacation',
    icon: '✈️',
    default_amount: 800_000,
    suggested_amounts: [400_000, 800_000, 1_500_000, 2_500_000],
    default_years: 3,
    default_risk: 'conservative',
    blurb: 'Save up for a once-in-a-lifetime trip.',
    category: 'short',
    liquid: true,
  },
];
