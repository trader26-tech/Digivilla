import { DEFAULT_CONFIG } from './default-config';
import { Window } from './history';
import { fdCumulative, simulatePayout } from './simulate';

/** A synthetic 8-year window (no network): each series grows at its own steady rate. */
function window8(): Window {
  const months: string[] = [];
  for (let i = 0; i <= 96; i++) { const m = 8 + i; months.push(`${2018 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`); }
  const series: [string, number, number][] = [['arbitrage', 0.36, 0.006], ['gold', 0.16, 0.009], ['large', 0.16, 0.01], ['mid', 0.16, 0.012], ['small', 0.16, 0.013]];
  return {
    months, years: 8, clamped: false,
    funds: series.map(([sleeve, weight, g]) => ({ sleeve, name: sleeve, weight, proxy: [], nav: months.map((_, i) => 100 * Math.pow(1 + g, i)) })),
  };
}

describe('the FD in simulatePayout', () => {
  const cfg = DEFAULT_CONFIG;
  const base = { amount: 1e7, fdRate: 6.5, slabPct: 30, swp: true };

  it('payout FD (the default) is unchanged: principal back, interest paid monthly, no cumulative fields', () => {
    const r = simulatePayout(window8(), base, cfg);
    expect(r.fdValue).toBe(1e7);
    expect(r.fdPaid).toBeCloseTo(1e7 * 6.5 / 1200 * (1 - 0.3 * (1 + cfg.tax.cess)) * 96, 6);
    expect('fdMode' in r).toBeFalse();
    expect('fdInterest' in r).toBeFalse();
    expect(JSON.stringify(simulatePayout(window8(), { ...base, fdMode: 'payout' }, cfg))).toBe(JSON.stringify(r));
  });

  it('cumulative FD = quarterly compounding, each year\'s interest taxed at the slab (+ cess), nothing paid', () => {
    const t = 0.3 * (1 + cfg.tax.cess);
    const want = 1e7 * Math.pow(1 + (1 - t) * (Math.pow(1 + 6.5 / 400, 4) - 1), 8);
    const r = simulatePayout(window8(), { ...base, swp: false, fdMode: 'cumulative' }, cfg);
    expect(r.fdTotal).toBeCloseTo(want, 4);
    expect(r.fdValue).toBe(r.fdTotal);
    expect(r.fdPaid).toBe(0);
    expect(r.fdMonthly).toBe(0);
    expect(r.fdValue - 1e7).toBeCloseTo(r.fdInterest! - r.fdTax!, 4);
  });

  it('a part year is credited pro rata and taxed at the end', () => {
    const t = 0.312;
    let b = 1e7, yi = 0;
    for (let q = 0; q < 4; q++) { const i = b * 0.065 / 4; b += i; yi += i; }
    b -= yi * t;
    const i2 = b * 0.065 / 12 * 2; b += i2; b -= i2 * t;
    expect(fdCumulative(1e7, 6.5, t, 14).value).toBeCloseTo(b, 4);
  });
});
