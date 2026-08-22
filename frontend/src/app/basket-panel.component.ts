import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { inr } from './format';
import { BasketStore } from './basket-store';
import { BasketItem, Goal } from './models';
import { PlannerService } from './planner.service';

@Component({
  selector: 'app-basket-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './basket-panel.component.html',
  styleUrl: './basket-panel.component.scss',
})
export class BasketPanelComponent implements OnInit {
  @Output() closePanel = new EventEmitter<void>();
  @Output() goExplore = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  readonly store = inject(BasketStore);
  private api = inject(PlannerService);

  goals: Goal[] = [];
  suggesting = false;
  saving = false;
  savedMsg = '';

  ngOnInit(): void {
    this.api.goals().subscribe((g) => (this.goals = g));
  }

  get items(): BasketItem[] {
    return this.store.items();
  }
  get totalWeight(): number {
    return this.items.reduce((s, i) => s + (i.weight || 0), 0);
  }

  suggestFor(goal: Goal): void {
    this.suggesting = true;
    this.store.linkGoal(goal);
    this.api.suggestBasket(goal.resolved_risk).subscribe({
      next: (r) => {
        this.store.setItems(r.items);
        this.store.risk.set(r.risk);
        this.suggesting = false;
      },
      error: () => (this.suggesting = false),
    });
  }

  linkGoal(goalId: string): void {
    const g = this.goals.find((x) => x.id === goalId) ?? null;
    this.store.linkGoal(g);
  }

  setWeight(code: number, val: string): void {
    const n = Number(val);
    if (!Number.isNaN(n)) this.store.setWeight(code, n / 100);
  }
  remove(code: number): void {
    this.store.remove(code);
  }
  balance(): void {
    this.store.rebalanceEqual();
    this.store.setItems([...this.store.items()]);
  }
  normalize(): void {
    this.store.normalize();
  }

  save(): void {
    if (!this.items.length || this.saving) return;
    this.saving = true;
    this.store.normalize();
    const g = this.store.linkedGoal();
    this.api
      .saveBasket({
        name: this.store.name(),
        goal_id: g?.id ?? null,
        goal_label: g?.label ?? null,
        risk: this.store.risk(),
        monthly_amount: g?.monthly_investment ?? null,
        items: this.store.items(),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.savedMsg = g
            ? `Basket saved and linked to "${g.label}".`
            : 'Basket saved.';
          this.saved.emit();
        },
        error: () => {
          this.saving = false;
          this.savedMsg = 'Could not save. Try again.';
        },
      });
  }

  monthlyFor(item: BasketItem): number {
    const monthly = this.store.linkedGoal()?.monthly_investment ?? 0;
    return Math.round(monthly * item.weight);
  }

  fmt = inr;
  pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }
  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)' }[a] ??
      'var(--accent)'
    );
  }
}
