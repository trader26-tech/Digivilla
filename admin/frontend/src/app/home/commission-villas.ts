/** Commission by VILLA — what one villa of each type earns a year, and what selling
 *  more of them adds. One villa = the settings' villa_cost (₹5 L) split over that
 *  type's villa bucket (bucket tier = the villa's name), at the saved trail rates. */
import type { CommissionOverview, VillaBucket, VillaTypeRow } from '../admin.service';
import { fundKey, shortName } from './commission-whatif';

export interface VillaComm {
  key: string; name: string;
  perYear: number;            // one villa's trail commission a year
  rate: number;               // its blended % a year
  missing: string[];          // its funds with no rate yet (counted at ₹0)
  held: number;               // villas of this type clients hold today
  heldYear: number;           // what those earn a year today (their real pinned funds)
}

const norm = (s?: string) => (s || '').trim().toLowerCase();

/** The bucket a villa type is built from: tier = its name, else a bucket named after it. */
export function bucketFor(name: string, buckets: VillaBucket[]): VillaBucket | undefined {
  const n = norm(name);
  return buckets.find((b) => norm(b.tier) === n && (b.kind ?? 'sip') === 'sip')
    ?? buckets.find((b) => norm(b.tier) === n)
    ?? buckets.find((b) => norm(b.name).includes(n));
}

export function villaComm(villaCost: number, c: CommissionOverview, buckets: VillaBucket[],
                          villas: { key: string; name: string }[], types: VillaTypeRow[]): VillaComm[] {
  const rates: Record<string, number | null> = {};
  for (const f of c.funds) rates[f.key] = f.rate_pct;
  return villas.map((v) => {
    const b = bucketFor(v.name, buckets);
    const tot = b ? b.funds.reduce((s, f) => s + (f.target_weight || 0), 0) || 1 : 1;
    let perYear = 0;
    const missing: string[] = [];
    for (const f of b?.funds ?? []) {
      const r = rates[fundKey(f.scheme_code, f.scheme_name)] ?? null;
      if (r === null) { missing.push(shortName(f.scheme_name)); continue; }
      perYear += (villaCost * ((f.target_weight || 0) / tot) * r) / 100;
    }
    const t = types.find((x) => x.key === v.key);
    return {
      key: v.key, name: v.name, perYear, rate: villaCost ? (perYear / villaCost) * 100 : 0,
      missing: b ? missing : ['no villa bucket'], held: t?.count ?? 0, heldYear: t?.commission ?? 0,
    };
  });
}
