import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  OnInit,
  Output,
} from '@angular/core';

import { GoalPreset } from './models';
import { PlannerService } from './planner.service';

/**
 * The app's true first screen — shown before any login.
 *
 * A grid of life goals the user can invest for. Tapping a goal selects it and
 * reveals a detail panel (blurb + suggested amounts + horizon) with a Continue
 * CTA. What Continue does downstream is wired up separately; this component's
 * job is a lively, no-login goal-selection experience for the PWA.
 */
@Component({
  selector: 'app-goal-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goal-picker.component.html',
  styleUrl: './goal-picker.component.scss',
})
export class GoalPickerComponent implements OnInit {
  /** Emitted when the user taps Continue on a chosen goal. */
  @Output() goalChosen = new EventEmitter<GoalPreset>();

  goals: GoalPreset[] = [];
  loading = true;
  errored = false;
  selected: GoalPreset | null = null;

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

  select(g: GoalPreset): void {
    this.selected = this.selected?.key === g.key ? null : g;
  }

  clearSelection(): void {
    this.selected = null;
  }

  continue(): void {
    if (this.selected) this.goalChosen.emit(this.selected);
  }

  /** trackBy so re-renders don't restart card entrance animations. */
  trackByKey(_: number, g: GoalPreset): string {
    return g.key;
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
  },
];
