/** ₹2.62 Cr / ₹36.4 L / ₹8,000 */
export function fmtInr(n: number): string {
  const s = n < 0 ? '−' : '';
  n = Math.abs(n);
  if (n >= 1e7) return s + '₹' + +(n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return s + '₹' + +(n / 1e5).toFixed(1) + ' L';
  return s + '₹' + Math.round(n).toLocaleString('en-IN');
}

export function ymLabel(ym: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = ym.split('-').map(Number);
  return `${M[m - 1]} ${y}`;
}
