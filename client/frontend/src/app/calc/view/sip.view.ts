import { SipIncomeResult, ymLabel } from '../engine';
import { bySleeve } from '../sleeves';
import { YearCol } from '../year-cols.component';

/** SIP, ready to draw: one column per year (put in · grew · that year's income) + the walk-through. */
export function sipView(r: SipIncomeResult, monthly: number) {
  // a window that isn't whole years (picked dates) ends with its part-year, up to the last month
  const n = r.months.length - 1;
  const rows = n % 12 === 0 ? r.yearly : [...r.yearly, { year: n / 12, month: r.months[n], invested: r.invested, value: r.value, payout: 0 }];
  const yearCols: YearCol[] = rows.map((y) => ({
    tick: y.year % 1 ? ymLabel(y.month).slice(0, 4) + '’' + y.month.slice(2, 4) : 'Y' + y.year,
    badge: y.year % 1 ? ymLabel(y.month) : 'Year ' + y.year,
    put: Math.min(y.invested, y.value), grew: Math.max(0, y.value - y.invested), cap: y.payout,
    fields: r.swp ? [
      { label: 'Put in', value: y.invested },
      { label: 'Worth', value: y.value, tone: 'g' as const },
      // income is paid at each full year, so the part-year shows what came in so far
      y.year % 1
        ? { label: 'Income so far', value: r.income, tone: 'gold' as const }
        : { label: 'Income', value: y.payout / 12, tone: 'gold' as const, suffix: '/mo' },
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
