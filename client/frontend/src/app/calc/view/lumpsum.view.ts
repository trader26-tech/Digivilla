import { PayoutResult, ymLabel } from '../engine';
import { bySleeve } from '../sleeves';
import { YearCol } from '../year-cols.component';

/** Lumpsum, ready to draw: one column per year end + the walk-through. */
export function lumpsumView(r: PayoutResult, amount: number) {
  const yearCols: YearCol[] = r.yearly.map((y) => ({
    tick: '’' + y.month.slice(2, 4), badge: ymLabel(y.month),
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
