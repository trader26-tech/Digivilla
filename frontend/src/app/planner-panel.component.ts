import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
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

/**
 * The conversational goal planner, extracted into a self-contained panel so it
 * can be docked as a collapsible chatbot on the right of the dashboard.
 */
@Component({
  selector: 'app-planner-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ProjectionChartComponent],
  templateUrl: './planner-panel.component.html',
  styleUrl: './planner-panel.component.scss',
})
export class PlannerPanelComponent implements OnInit {
  @Output() closePanel = new EventEmitter<void>();
  @Output() goalSaved = new EventEmitter<void>();

  saving = false;
  saved = false;

  step: Step = 'goal';
  presets: GoalPreset[] = [];
  loadError: string | null = null;

  goal: GoalPreset | null = null;
  amount = 0;
  years = 0;
  risk: string | null = null;

  amountMin = 0;
  amountMax = 0;
  yearOptions = [2, 3, 5, 8, 10, 15, 20, 25, 30];

  chat: ChatBubble[] = [];
  plan: PlanResponse | null = null;
  generating = false;

  readonly riskChoices = [
    { key: 'conservative', label: 'Low' },
    { key: 'balanced', label: 'Balanced' },
    { key: 'aggressive', label: 'High' },
  ];

  constructor(private planner: PlannerService) {}

  ngOnInit(): void {
    this.planner.presets().subscribe({
      next: (p) => {
        this.presets = p;
        this.pushBot('What are you saving for?');
      },
      error: () => {
        this.loadError = "Couldn't reach the planner service.";
      },
    });
  }

  private pushBot(text: string) {
    this.chat.push({ who: 'bot', text });
  }
  private pushUser(text: string) {
    this.chat.push({ who: 'user', text });
  }

  selectGoal(g: GoalPreset) {
    this.goal = g;
    this.risk = g.default_risk;
    this.amount = g.default_amount;
    this.years = g.default_years;
    const lo = Math.min(...g.suggested_amounts);
    const hi = Math.max(...g.suggested_amounts);
    this.amountMin = Math.round(lo / 2);
    this.amountMax = Math.round(hi * 1.5);
    this.pushUser(`${g.icon} ${g.label}`);
    this.pushBot('How much do you need?');
    this.step = 'amount';
  }

  pickAmount(v: number) {
    this.amount = v;
  }
  onAmountInput(v: string) {
    const n = Number(v.replace(/[^0-9]/g, ''));
    if (!Number.isNaN(n)) this.amount = n;
  }
  confirmAmount() {
    if (this.amount <= 0) return;
    this.pushUser(inrFull(this.amount));
    this.pushBot('By when?');
    this.step = 'timing';
  }

  pickYears(y: number) {
    this.years = y;
  }
  confirmTiming() {
    if (this.years <= 0) return;
    this.pushUser(`In ${this.years} years`);
    this.generate();
  }

  generate() {
    if (!this.goal) return;
    this.step = 'generating';
    this.generating = true;
    this.pushBot('Building your plan…');
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
          this.pushBot('Something went wrong. Try again.');
        },
      });
  }

  saveGoal() {
    if (!this.plan || !this.goal || this.saving) return;
    this.saving = true;
    this.planner
      .saveGoal({
        goal: this.plan.goal,
        label: this.goal.label,
        target_amount: this.plan.target_amount,
        horizon_years: this.plan.horizon_years,
        resolved_risk: this.plan.resolved_risk,
        monthly_investment: this.plan.monthly_investment,
        expected_return: this.plan.expected_return,
        projected_p50: this.plan.projected_p50,
        projected_p10: this.plan.projected_p10,
        projected_p90: this.plan.projected_p90,
        success_rate: this.plan.success_rate,
        recommendations: this.plan.recommendations.map((r) => ({
          name: r.name,
          asset_class: r.asset_class,
          weight: r.weight,
          monthly_amount: r.monthly_amount,
        })),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.saved = true;
          this.goalSaved.emit();
        },
        error: () => {
          this.saving = false;
          this.pushBot('Could not save. Try again.');
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
    this.saved = false;
    this.chat = [];
    this.pushBot('What are you saving for?');
  }

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
