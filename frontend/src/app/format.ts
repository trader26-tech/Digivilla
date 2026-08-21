/** Format a rupee amount with Indian lakh/crore words. */
export function inr(value: number, decimals = 2): string {
  const v = Math.round(value);
  if (Math.abs(v) >= 1e7) {
    return `₹${(v / 1e7).toFixed(decimals)} Cr`;
  }
  if (Math.abs(v) >= 1e5) {
    return `₹${(v / 1e5).toFixed(decimals)} L`;
  }
  return `₹${v.toLocaleString('en-IN')}`;
}

/** Compact rupee with Indian digit grouping, no lakh/crore words. */
export function inrFull(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
