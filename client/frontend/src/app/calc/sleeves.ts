/** Plain names + colours for the kinds of fund in the mix, for the simple explainers. */
export const SLEEVES: Record<string, { label: string; color: string; plain: string }> = {
  arbitrage: { label: 'Arbitrage', color: '#7fb39b', plain: 'the steady part — pays you' },
  large: { label: 'Large cap', color: '#3f7a20', plain: 'big companies' },
  mid: { label: 'Mid cap', color: '#4f9528', plain: 'mid-size companies' },
  small: { label: 'Small cap', color: '#8fd65a', plain: 'small companies' },
  gold: { label: 'Gold', color: '#e9c15c', plain: 'gold' },
  other: { label: 'Other', color: '#9397ab', plain: 'other funds' },
};
const ORDER = ['arbitrage', 'large', 'mid', 'small', 'gold', 'other'];

export interface SleeveRow { key: string; label: string; color: string; plain: string; pct: number; start: number; now: number; }

/** Funds grouped by kind (two small-cap funds read as one "Small cap"), in a fixed order. */
export function bySleeve(rows: { sleeve: string; weight: number; start: number; now: number }[]): SleeveRow[] {
  const m = new Map<string, SleeveRow>();
  for (const r of rows) {
    const key = SLEEVES[r.sleeve] ? r.sleeve : 'other';
    const s = m.get(key) ?? { key, ...SLEEVES[key], pct: 0, start: 0, now: 0 };
    s.pct += r.weight * 100; s.start += r.start; s.now += r.now;
    m.set(key, s);
  }
  return ORDER.filter((k) => m.has(k)).map((k) => m.get(k)!);
}
