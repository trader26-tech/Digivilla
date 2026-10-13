/** Villa mapper — pure logic (no Angular): transactions → purchases, a purchase's
 *  villa type read from its mix, and where each unpinned purchase should go. */
import type { ClientTxn, ClientVilla, VillaBucket, VillaType } from '../admin.service';

export const VILLA_FULL = 500_000;
export const TYPES: { key: VillaType; label: string; short: string }[] = [
  { key: 'conservative', label: 'Conservative', short: 'C' },
  { key: 'balanced', label: 'Balanced', short: 'B' },
  { key: 'aggressive', label: 'Aggressive', short: 'A' },
];
export const SLEEVE_ORDER = ['arbitrage', 'large', 'mid', 'small', 'gold', 'other'];

export interface Purchase {
  key: string; date: string; kind: string; total: number; txns: ClientTxn[];
  /** the villa every line is pinned to (null when unpinned or split) */
  villaId: string | null;
  /** some lines pinned somewhere, the rest elsewhere / nowhere */
  mixed: boolean;
  /** every line is in a fund that sits in some villa bucket */
  villaFunds: boolean;
  /** ₹ share by sleeve, for the little mix bar */
  sleeves: { sleeve: string; share: number }[];
  /** the villa type this mix matches (by its arbitrage share), null when it can't be told */
  type: VillaType | null;
  /** where it should go: a villa id, or 'new' */
  suggest: string;
}

/** What the buckets say about funds and types. */
export interface BucketInfo {
  sleeveOf: Map<number, string>;
  /** arbitrage share of each villa type (from its bucket) */
  arbOf: Partial<Record<VillaType, number>>;
}

export function bucketInfo(buckets: VillaBucket[]): BucketInfo {
  const sleeveOf = new Map<number, string>();
  const arbOf: Partial<Record<VillaType, number>> = {};
  for (const b of buckets) {
    const tot = b.funds.reduce((s, f) => s + (f.target_weight || 0), 0) || 1;
    let arb = 0;
    for (const f of b.funds) {
      const s = f.sleeve || guessSleeve(f.scheme_name, f.category);
      if (f.scheme_code) sleeveOf.set(Number(f.scheme_code), s);
      if (s === 'arbitrage') arb += (f.target_weight || 0) / tot;
    }
    const t = typeFromName(`${b.tier || ''} ${b.name}`);
    if (t) arbOf[t] = arb;
  }
  return { sleeveOf, arbOf };
}

function typeFromName(s: string): VillaType | null {
  const n = s.toLowerCase();
  return n.includes('conservative') ? 'conservative' : n.includes('aggressive') ? 'aggressive'
    : n.includes('balanced') || n.includes('moderate') ? 'balanced' : null;
}
function guessSleeve(name: string, cat?: string): string {
  const n = `${name} ${cat || ''}`.toLowerCase();
  if (n.includes('arbitrage')) return 'arbitrage';
  if (n.includes('gold')) return 'gold';
  if (n.includes('small')) return 'small';
  if (n.includes('mid')) return 'mid';
  if (/large|bluechip|nifty 50|top 100/.test(n)) return 'large';
  return 'other';
}

/** The type whose arbitrage share is nearest (within 8 points), else null. */
export function typeOfMix(arbShare: number, info: BucketInfo): VillaType | null {
  let best: VillaType | null = null, gap = 0.08;
  for (const t of TYPES) {
    const a = info.arbOf[t.key];
    if (a === undefined) continue;
    const d = Math.abs(a - arbShare);
    if (d <= gap) { gap = d; best = t.key; }
  }
  return best;
}

const amt = (t: ClientTxn) => Math.abs(t.amount || 0);

/** Transactions grouped into purchases (same day, same type), newest first, with suggestions. */
export function purchases(txns: ClientTxn[], villas: ClientVilla[], info: BucketInfo): Purchase[] {
  const groups = new Map<string, ClientTxn[]>();
  for (const t of txns) {
    const kind = (t.kind || 'Purchase').trim();
    const key = `${(t.txn_date || '').slice(0, 10)}|${kind.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: Purchase[] = [];
  for (const [key, ts] of groups) {
    const ids = new Set(ts.map((t) => t.villa_id ?? null));
    const total = ts.reduce((s, t) => s + amt(t), 0);
    const by = new Map<string, number>();
    for (const t of ts) {
      const s = (t.scheme_code && info.sleeveOf.get(Number(t.scheme_code))) || 'other';
      by.set(s, (by.get(s) ?? 0) + amt(t));
    }
    const sleeves = SLEEVE_ORDER.filter((s) => by.has(s)).map((s) => ({ sleeve: s, share: total ? by.get(s)! / total : 0 }));
    const villaFunds = !by.has('other');
    out.push({
      key, date: (ts[0].txn_date || '').slice(0, 10), kind: (ts[0].kind || 'Purchase').trim(), total, txns: ts,
      villaId: ids.size === 1 ? [...ids][0] : null, mixed: ids.size > 1,
      villaFunds, sleeves,
      type: villaFunds ? typeOfMix((by.get('arbitrage') ?? 0) / (total || 1), info) : null,
      suggest: 'new',
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));

  // suggestions, oldest first so open plots fill in time order: a villa of the same
  // type that still has room, else a new one (a full ₹5L purchase is its own villa)
  const room = new Map(villas.map((v) => [v.id, v.finished ? 0 : VILLA_FULL - v.mapped_total]));
  for (const p of [...out].reverse()) {
    if (p.villaId) continue;
    if (p.total >= VILLA_FULL * 0.99) { p.suggest = 'new'; continue; }
    const fit = villas.find((v) => (room.get(v.id) ?? 0) >= p.total - 1 && (!p.type || !v.villa_type || v.villa_type === p.type));
    if (fit) { p.suggest = fit.id; room.set(fit.id, (room.get(fit.id) ?? 0) - p.total); }
  }
  return out;
}

/** The client's name for a villa — what their app shows (Villa 1, Plot 3). */
export function villaLabel(v: ClientVilla): string {
  if (v.position === null || v.position === undefined) return 'Empty villa';
  return (v.finished ? 'Villa ' : 'Plot ') + (v.position + 1);
}

/** The type a villa's pinned money actually looks like (null when it can't be told). */
export function villaMixType(v: ClientVilla, ps: Purchase[], info: BucketInfo): VillaType | null {
  const mine = ps.filter((p) => p.villaId === v.id);
  const total = mine.reduce((s, p) => s + p.total, 0);
  if (!total || mine.some((p) => !p.villaFunds)) return null;
  const arb = mine.reduce((s, p) => s + p.total * (p.sleeves.find((x) => x.sleeve === 'arbitrage')?.share ?? 0), 0);
  return typeOfMix(arb / total, info);
}
