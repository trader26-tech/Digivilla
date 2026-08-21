import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { inr, inrFull } from './format';
import { GoalPreset, PlanResponse } from './models';
import { PlannerService } from './planner.service';
import { ProjectionChartComponent } from './projection-chart.component';

type Step = 'goal' | 'amount' | 'timing' | 'generating' | 'result';

interface ChatBubble {
  who: 'bot' | 'user';
  text: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ProjectionChartComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  step: Step = 'goal';
  presets: GoalPreset[] = [];
  loadError: string | null = null;

  // selections
  goal: GoalPreset | null = null;
  amount = 0;
  years = 0;
  risk: string | null = null;

  // slider bounds derived from the chosen goal
  amountMin = 0;
  amountMax = 0;

  yearOptions = [2, 3, 5, 8, 10, 15, 20, 25, 30];

  chat: ChatBubble[] = [];
  plan: PlanResponse | null = null;
  generating = false;

  readonly riskChoices = [
    { key: 'conservative', label: 'Play it safe', desc: 'Lower risk, steadier growth' },
    { key: 'balanced', label: 'Balanced', desc: 'A mix of growth and stability' },
    { key: 'aggressive', label: 'Go for growth', desc: 'Higher risk, higher potential' },
  ];

  constructor(private planner: PlannerService) {}

  ngOnInit(): void {
    this.planner.presets().subscribe({
      next: (p) => {
        this.presets = p;
        this.pushBot("Hi! I'm your goal planner. What are you saving for?");
      },
      error: () => {
        this.loadError = "Couldn't reach the planner service. Is the API running on :8000?";
      },
    });
  }

  // --- chat helpers -------------------------------------------------------
  private pushBot(text: string) {
    this.chat.push({ who: 'bot', text });
  }
  private pushUser(text: string) {
    this.chat.push({ who: 'user', text });
  }

  // --- step 1: goal -------------------------------------------------------
  selectGoal(g: GoalPreset) {
    this.goal = g;
    this.risk = g.default_risk;
    this.amount = g.default_amount;
    this.years = g.default_years;
    // slider bounds: from half the smallest suggestion to 1.5x the largest
    const lo = Math.min(...g.suggested_amounts);
    const hi = Math.max(...g.suggested_amounts);
    this.amountMin = Math.round(lo / 2);
    this.amountMax = Math.round(hi * 1.5);
    this.pushUser(`${g.icon} ${g.label}`);
    this.pushBot(`Great choice. How much do you need for your ${g.label.toLowerCase()} goal?`);
    this.step = 'amount';
  }

  // --- step 2: amount -----------------------------------------------------
  pickAmount(v: number) {
    this.amount = v;
  }
  onAmountInput(v: string) {
    const n = Number(v.replace(/[^0-9]/g, ''));
    if (!Number.isNaN(n)) {
      this.amount = n;
    }
  }
  confirmAmount() {
    if (this.amount <= 0) return;
    this.pushUser(inrFull(this.amount));
    this.pushBot('When do you want to reach this goal?');
    this.step = 'timing';
  }

  // --- step 3: timing -----------------------------------------------------
  pickYears(y: number) {
    this.years = y;
  }
  confirmTiming() {
    if (this.years <= 0) return;
    this.pushUser(`In ${this.years} years`);
    this.generate();
  }

  // --- generate -----------------------------------------------------------
  generate() {
    if (!this.goal) return;
    this.step = 'generating';
    this.generating = true;
    this.pushBot('Crunching 5,000 Monte Carlo simulations and picking your funds…');
    this.planner
      .plan({
        goal: this.goal.key,
        target_amount: this.amount,
        horizon_years: this.years,
        risk: this.risk ?? undefined,
      })
      .subscribe({
        next: (res) => {
          this.plan = res;
          this.generating = false;
          this.step = 'result';
          this.pushBot(res.summary);
        },
        error: () => {
          this.generating = false;
          this.step = 'timing';
          this.pushBot('Something went wrong generating the plan. Please try again.');
        },
      });
  }

  restart() {
    this.step = 'goal';
    this.goal = null;
    this.plan = null;
    this.amount = 0;
    this.years = 0;
    this.risk = null;
    this.chat = [];
    this.pushBot("Let's plan another goal. What are you saving for?");
  }

  // --- formatting helpers for the template --------------------------------
  fmt = inr;
  fmtFull = inrFull;

  pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }
  pct1(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
  }

  assetColor(assetClass: string): string {
    return (
      {
        equity: 'var(--eq)',
        hybrid: 'var(--hy)',
        debt: 'var(--dt)',
        gold: 'var(--gd)',
      }[assetClass] ?? 'var(--accent)'
    );
  }

  get successTone(): string {
    const s = this.plan?.success_rate ?? 0;
    if (s >= 0.6) return 'good';
    if (s >= 0.45) return 'ok';
    return 'low';
  }
}
