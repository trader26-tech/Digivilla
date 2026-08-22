import { Injectable, signal } from '@angular/core';

import { BasketItem, DashboardFund, Goal } from './models';

/**
 * In-progress ("working") basket shared across the app: Research adds funds to
 * it, the basket builder edits weights, and it can be linked to a goal and saved.
 * Persisted to localStorage so it survives a refresh before the user saves.
 */
@Injectable({ providedIn: 'root' })
export class BasketStore {
  readonly items = signal<BasketItem[]>([]);
  readonly linkedGoal = signal<Goal | null>(null);
  readonly name = signal<string>('My basket');
  readonly risk = signal<string | null>(null);
  readonly editingId = signal<string | null>(null); // set when editing a saved basket

  private readonly KEY = 'wp_working_basket';

  constructor() {
    this.restore();
  }

  has(schemeCode: number): boolean {
    return this.items().some((i) => i.scheme_code === schemeCode);
  }

  count(): number {
    return this.items().length;
  }

  addFund(f: DashboardFund): void {
    if (this.has(f.scheme_code)) return;
    const item: BasketItem = {
      scheme_code: f.scheme_code,
      name: f.name,
      fund_house: f.fund_house,
      bucket: f.bucket,
      asset_class: f.asset_class,
      rating: f.rating,
      return_1y: f.return_1y,
      return_3y: f.return_3y,
      return_5y: f.return_5y,
      weight: 0,
      sleeve: f.asset_class,
    };
    const next = [...this.items(), item];
    this.rebalanceEqual(next);
    this.items.set(next);
    this.persist();
  }

  remove(schemeCode: number): void {
    const next = this.items().filter((i) => i.scheme_code !== schemeCode);
    this.items.set(next);
    this.persist();
  }

  setWeight(schemeCode: number, weight: number): void {
    const next = this.items().map((i) =>
      i.scheme_code === schemeCode ? { ...i, weight } : i,
    );
    this.items.set(next);
    this.persist();
  }

  setItems(items: BasketItem[]): void {
    this.items.set(items);
    this.persist();
  }

  normalize(): void {
    const items = this.items();
    const sum = items.reduce((s, i) => s + (i.weight || 0), 0);
    if (sum > 0) {
      this.items.set(items.map((i) => ({ ...i, weight: +(i.weight / sum).toFixed(4) })));
      this.persist();
    }
  }

  rebalanceEqual(list = this.items()): void {
    const n = list.length;
    if (n === 0) return;
    const w = +(1 / n).toFixed(4);
    list.forEach((i) => (i.weight = w));
  }

  linkGoal(g: Goal | null): void {
    this.linkedGoal.set(g);
    if (g) this.name.set(`${g.label} basket`);
    this.persist();
  }

  clear(): void {
    this.items.set([]);
    this.linkedGoal.set(null);
    this.name.set('My basket');
    this.risk.set(null);
    this.editingId.set(null);
    localStorage.removeItem(this.KEY);
  }

  private persist(): void {
    localStorage.setItem(
      this.KEY,
      JSON.stringify({
        items: this.items(),
        linkedGoal: this.linkedGoal(),
        name: this.name(),
        risk: this.risk(),
        editingId: this.editingId(),
      }),
    );
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      this.items.set(s.items ?? []);
      this.linkedGoal.set(s.linkedGoal ?? null);
      this.name.set(s.name ?? 'My basket');
      this.risk.set(s.risk ?? null);
      this.editingId.set(s.editingId ?? null);
    } catch {
      /* ignore */
    }
  }
}
