/**
 * Canonical number/currency formatting for the whole app.
 *
 * Before this existed, five components each defined their own `compact()` and
 * four defined `inr()` — with subtly different rounding (₹10 L vs ₹10.0 L vs
 * ₹10L). Import from here instead so every figure reads identically.
 */

/** Compact Indian-currency: ₹1.8 Cr / ₹28.3 L / ₹8,000. */
export function compact(v: number): string {
  if (v >= 1_00_00_000) {
    const cr = v / 1_00_00_000;
    return `₹${cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')} Cr`;
  }
  if (v >= 1_00_000) {
    const l = v / 1_00_000;
    return `₹${l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')} L`;
  }
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/**
 * Like compact(), but also abbreviates thousands as "K" so nothing is ever
 * written out in full: ₹1.8 Cr / ₹28.3 L / ₹30 K / ₹850.
 */
export function compactK(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_00_000) return compact(v);
  if (abs >= 1_000) {
    const k = v / 1_000;
    return `₹${k % 1 === 0 ? k : k.toFixed(1).replace(/\.0$/, '')} K`;
  }
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/** Full rupees with Indian digit grouping: ₹12,50,000. */
export function inr(v: number | null | undefined): string {
  if (v == null) return '—';
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/** A percentage to one decimal, or an em dash for null: 12.4% / —. */
export function pct(v: number | null | undefined, decimals = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(decimals)}%`;
}
