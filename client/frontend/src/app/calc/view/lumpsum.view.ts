import { PayoutResult, ymLabel } from '../engine';
import { bySleeve } from '../sleeves';
import { YearCol } from '../year-cols.component';

/** Lumpsum, ready to draw: one column per year end + the walk-through. */
export function lumpsumView(r: PayoutResult, amount: number) {
  // a window that isn't whole years (picked dates) ends with its part-year, up to the last month
  const n = r.months.length - 1;
  const years = n % 12 === 0 ? r.yearly : [...r.yearly, {
    year: n / 12, month: r.months[n], value: r.dvValue,
    payout: r.dvPaidGross - r.yearly.reduce((s, y) => s + y.payout, 0), income: r.dvPaid,
  }];
  const yearCols: YearCol[] = years.map((y) => ({
    // the part-year column says its month, so it can't read like a second column for the same year
    tick: (y.year % 1 ? ymLabel(y.month).slice(0, 4) : '') + '’' + y.month.slice(2, 4), badge: ymLabel(y.month),
    put: Math.min(amount, y.value), grew: Math.max(0, y.value - amount), cap: r.swp ? y.payout : 0,
    fields: r.swp ? [
      { label: 'Worth', value: y.value, tone: 'g' as const },
      { label: 'Income so far', value: y.income, tone: 'gold' as const },
      { label: 'Worth + income', value: y.value + y.income },
    ] : [
      { label: 'Put in', value: amount },
      { label: 'Worth', value: y.value, tone: 'g' as const },
      { label: 'Grew', value: y.value - amount },
    ],
  }));
  const explain = {
    mix: bySleeve(r.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.valueStart, now: f.valueNow }))),
    payments: r.months.length - 1,
    taxTiny: r.dvPayoutTax < r.dvPaidGross * 0.01,
  };
  return { yearCols, explain };
}
