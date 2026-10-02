import { Fund } from './history';
import { Gains, TaxRules, noGains } from './tax';
import { CalcConfig } from './types';

/** One rebalance: each part's value before and after, and what moved. */
export interface Rebalance {
  month: string;                     // the month-end close it was done at
  before: number[];                  // ₹ per fund, same order as w.funds
  after: number[];
  moved: number[];                   // ₹ bought (+) / sold (−) per fund
  tax: number;                       // tax paid out of the proceeds
}

interface Lot { u: number; nav: number; i: number; }

/**
 * The holdings: every purchase is a LOT (units, price, month); sales take the
 * oldest lots first, so each sale's gain and holding period are exact. Each
 * sale is charged the tax it ADDS to its financial year (exemption used in
 * order). WHICH parts pay the income and WHICH are rebalanced come from the
 * settings (income.pay_first, rebalance.parts) — nothing is named here.
 */
export class Book {
  lots: Lot[][];
  year = noGains();
  charged = 0;
  private payFirst: number[];
  private rebal: number[];
  constructor(public funds: Fund[], private rules: TaxRules, cfg: CalcConfig) {
    this.lots = funds.map(() => []);
    const idx = (keys: string[]) => keys.map((k) => funds.findIndex((f) => f.sleeve === k)).filter((k) => k >= 0);
    this.payFirst = idx(cfg.income.pay_first);
    this.rebal = idx(cfg.rebalance.parts).filter((k) => funds[k].weight > 0);
  }
  units(k: number): number { return this.lots[k].reduce((s, l) => s + l.u, 0); }
  val(k: number, i: number): number { return this.units(k) * this.funds[k].nav[i]; }
  total(i: number): number { return this.funds.reduce((s, _, k) => s + this.val(k, i), 0); }
  /** the parts the income comes from first (arbitrage today) */
  get firstPayers(): number[] { return this.payFirst; }
  buy(k: number, rupees: number, i: number): void {
    if (rupees > 1e-9) this.lots[k].push({ u: rupees / this.funds[k].nav[i], nav: this.funds[k].nav[i], i });
  }
  private walk(k: number, rupees: number, i: number, g: Gains, take: boolean): void {
    let u = rupees / this.funds[k].nav[i];
    for (let j = 0; u > 1e-12 && j < this.lots[k].length; j++) {
      const l = this.lots[k][j], q = Math.min(u, l.u);
      this.rules.add(g, this.funds[k].sleeve, q * (this.funds[k].nav[i] - l.nav), i - l.i);
      u -= q;
      if (take) l.u -= q;
    }
    if (take) this.lots[k] = this.lots[k].filter((l) => l.u > 1e-12);
  }
  sell(k: number, rupees: number, i: number): void { if (rupees > 1e-9) this.walk(k, rupees, i, this.year, true); }
  /** tax these sales would ADD to the year so far (nothing is sold) */
  taxIf(sells: number[], i: number): number {
    const g: Gains = { ...this.year };
    sells.forEach((r, k) => { if (r > 1e-9) this.walk(k, r, i, g, false); });
    return Math.max(0, this.rules.tax(g) - this.charged);
  }
  /** after a sale: charge the tax it added to the year */
  charge(): number {
    const inc = Math.max(0, this.rules.tax(this.year) - this.charged);
    this.charged += inc;
    return inc;
  }
  /** financial year end: anything over-charged (a later loss) goes back into the rebalanced parts */
  closeYear(i: number): number {
    const credit = Math.max(0, this.charged - this.rules.tax(this.year));
    this.year = noGains();
    this.charged = 0;
    if (credit > 0) {
      const g = this.rebal.length ? this.rebal : this.funds.map((_, k) => k).filter((k) => !this.payFirst.includes(k));
      const G = g.reduce((s, k) => s + this.val(k, i), 0);
      const W = g.reduce((s, k) => s + this.funds[k].weight, 0) || 1;
      g.forEach((k) => this.buy(k, credit * (G > 0 ? this.val(k, i) / G : this.funds[k].weight / W), i));
    }
    return credit;
  }
  /** raise ₹need: the pay-first parts in order, then everything else pro-rata. True if the pay-first parts ran short. */
  pay(need: number, i: number): boolean {
    for (const k of this.payFirst) {
      const take = Math.min(need, this.val(k, i));
      if (take > 0) this.sell(k, take, i);
      need -= take;
    }
    if (need <= 1e-6) return false;
    const vals = this.funds.map((_, k) => (this.payFirst.includes(k) ? 0 : this.val(k, i)));
    const tot = vals.reduce((s, v) => s + v, 0);
    if (tot > 0) vals.forEach((v, k) => { if (v > 0) this.sell(k, Math.min(v, (need * v) / tot), i); });
    return true;
  }
  /** the yearly rebalance: the rebalanced parts back to their split of (value − tax); the rest untouched */
  rebalance(i: number, month: string): Rebalance | null {
    const parts = this.rebal;
    const wsum = parts.reduce((s, k) => s + this.funds[k].weight, 0);
    const before = this.funds.map((_, k) => this.val(k, i));
    const G = parts.reduce((s, k) => s + before[k], 0);
    if (!(G > 0) || !(wsum > 0) || parts.length < 2) return null;
    const sellsFor = (tax: number) => this.funds.map((f, k) =>
      parts.includes(k) ? Math.max(0, before[k] - ((G - tax) * f.weight) / wsum) : 0);
    let tax = 0;
    for (let it = 0; it < 30; it++) {                  // the tax depends on the sells, the sells on the tax
      const t = this.taxIf(sellsFor(tax), i);
      if (Math.abs(t - tax) < 1e-6) break;
      tax = t;
    }
    const sells = sellsFor(tax);
    sells.forEach((r, k) => this.sell(k, r, i));
    const paid = this.charge();
    const cash = sells.reduce((s, r) => s + r, 0) - paid;
    const need = this.funds.map((f, k) => (parts.includes(k) ? Math.max(0, ((G - tax) * f.weight) / wsum - before[k]) : 0));
    const nTot = need.reduce((s, v) => s + v, 0);
    need.forEach((v, k) => { if (v > 0 && nTot > 0) this.buy(k, (cash * v) / nTot, i); });
    const after = this.funds.map((_, k) => this.val(k, i));
    return { month, before, after, moved: after.map((v, k) => v - before[k]), tax: paid };
  }
}
