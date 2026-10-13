/** Commission what-if: what a sum earns a year in each mix, at the saved trail rates. */
import type { CommissionOverview, VillaBucket } from '../admin.service';

export interface MixLine { key: string; name: string; weight: number; rate: number | null; yearly: number; note?: string }
export interface Mix { key: string; name: string; sub: string; lines: MixLine[]; yearly: number; rate: number; gaps: number }

const SLEEVES = ['arbitrage', 'gold', 'large', 'mid', 'small'];
const SLEEVE_NAME: Record<string, string> = { arbitrage: 'Arbitrage', gold: 'Gold', large: 'Large cap', mid: 'Mid cap', small: 'Small cap' };

/** The fund key the commission page uses: the scheme code, else "name:…". */
export const fundKey = (code: number | null | undefined, name: string) =>
  code ? String(code) : 'name:' + (name || '').trim().toLowerCase();

/** A fund's sleeve: set by the admin on the bucket, else read from its name. */
export function sleeveOf(f: { sleeve?: string; scheme_name: string; category?: string }): string {
  if (f.sleeve && SLEEVES.includes(f.sleeve)) return f.sleeve;
  const n = (f.scheme_name + ' ' + (f.category || '')).toLowerCase();
  if (n.includes('arbitrage')) return 'arbitrage';
  if (n.includes('gold')) return 'gold';
  if (n.includes('small')) return 'small';
  if (n.includes('mid')) return 'mid';
  if (/large|bluechip|nifty 50|top 100|focused/.test(n)) return 'large';
  return 'other';
}

export const shortName = (n: string) =>
  n.replace(/\s*-\s*(Regular|Direct).*$/i, '').replace(/\s+(Fund\s*)?(-\s*)?Growth\s*$/i, '').replace(/\s+Fund\s*$/i, '').trim();

function build(key: string, name: string, sub: string, amount: number,
               parts: { key: string; name: string; weight: number; note?: string }[], rates: Record<string, number | null>): Mix {
  const lines = parts.filter((p) => p.weight > 0).map((p) => {
    const rate = p.note ? null : rates[p.key] ?? null;
    return { ...p, rate, yearly: rate === null ? 0 : (amount * p.weight * rate) / 100 };
  }).sort((a, b) => b.weight - a.weight);
  const yearly = lines.reduce((s, l) => s + l.yearly, 0);
  return { key, name, sub, lines, yearly, rate: amount ? (yearly / amount) * 100 : 0, gaps: lines.filter((l) => l.rate === null).length };
}

/** Every mix worth comparing: today's book, each villa bucket, and the three villas
 *  (calculator settings) laid onto the bucket's funds by sleeve. */
export function mixes(amount: number, c: CommissionOverview, buckets: VillaBucket[],
                      villas: { key: string; name: string; weights: Record<string, number> }[]): Mix[] {
  const rates: Record<string, number | null> = {};
  for (const f of c.funds) rates[f.key] = f.rate_pct;
  const out: Mix[] = [];

  // 1 · the book as it stands
  const aum = c.totals.aum || 0;
  if (aum > 0) {
    out.push(build('book', 'Our book today', 'what clients hold now', amount,
      c.funds.filter((f) => f.aum > 0).map((f) => ({ key: f.key, name: shortName(f.scheme_name), weight: f.aum / aum })), rates));
  }

  // 2 · each villa bucket, as built (identical fund lists shown once)
  const seen = new Set<string>();
  for (const b of buckets) {
    const tot = b.funds.reduce((s, f) => s + (f.target_weight || 0), 0) || 1;
    const sig = b.funds.map((f) => fundKey(f.scheme_code, f.scheme_name) + ':' + f.target_weight).sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(build('b:' + b.id, b.name, 'villa bucket' + (b.kind ? ' · ' + b.kind : ''), amount,
      b.funds.map((f) => ({ key: fundKey(f.scheme_code, f.scheme_name), name: shortName(f.scheme_name), weight: (f.target_weight || 0) / tot })), rates));
  }

  // 3 · the villas: each sleeve's share split over the bucket funds in that sleeve
  const pool = buckets[0]?.funds ?? [];
  const bySleeve: Record<string, { key: string; name: string; w: number }[]> = {};
  for (const f of pool) {
    const s = sleeveOf(f);
    (bySleeve[s] ||= []).push({ key: fundKey(f.scheme_code, f.scheme_name), name: shortName(f.scheme_name), w: f.target_weight || 1 });
  }
  for (const v of villas) {
    const parts: { key: string; name: string; weight: number; note?: string }[] = [];
    for (const [sleeve, w] of Object.entries(v.weights)) {
      if (!w) continue;
      const fs = bySleeve[sleeve];
      if (!fs?.length) { parts.push({ key: 'none:' + sleeve, name: SLEEVE_NAME[sleeve] ?? sleeve, weight: w, note: 'no fund' }); continue; }
      const tw = fs.reduce((s, f) => s + f.w, 0);
      for (const f of fs) parts.push({ key: f.key, name: f.name, weight: (w * f.w) / tw });
    }
    const growth = Math.round((1 - (v.weights['arbitrage'] || 0)) * 100);
    out.push(build('v:' + v.key, v.name + ' villa', `${growth}% growth · ${100 - growth}% arb`, amount, parts, rates));
  }
  return out;
}
