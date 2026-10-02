import { SipIncomeResult } from '../engine';
import { bySleeve } from '../sleeves';
import { YearCol } from '../year-cols.component';

/** SIP, ready to draw: one column per year (put in · grew · that year's income) + the walk-through. */
export function sipView(r: SipIncomeResult, monthly: number) {
  const yearCols: YearCol[] = r.yearly.map((y) => ({
    tick: 'Y' + y.year, badge: 'Year ' + y.year,
    put: Math.min(y.invested, y.value), grew: Math.max(0, y.value - y.invested), cap: y.payout,
    fields: r.swp ? [
      { label: 'Put in', value: y.invested },
      { label: 'Worth', value: y.value, tone: 'g' as const },
      { label: 'Income', value: y.payout / 12, tone: 'gold' as const, suffix: '/mo' },
    ] : [
      { label: 'Put in', value: y.invested },
      { label: 'Worth', value: y.value, tone: 'g' as const },
      { label: 'Grew', value: y.value - y.invested },
    ],
  }));
  const mix = bySleeve(r.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.invested, now: f.valueNow })));
  const first = r.yearly[0], last = r.yearly[r.yearly.length - 1];
  const explain = { mix, perInstalment: mix.map((m) => ({ ...m, amt: monthly * m.pct / 100 })), firstIncome: first?.payout ?? 0, lastIncome: last?.payout ?? 0 };
  return { yearCols, explain };
}
