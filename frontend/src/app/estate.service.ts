import { Injectable, signal } from '@angular/core';

/** The three tile kinds, each with a distinct money mechanic:
 *  - land:     bought outright. NO rent — capital sits in an equity growth
 *              basket. Symbolic of a pure-appreciation plot.
 *  - building: a villa under construction. A monthly SIP accrues toward the
 *              villa's cost; NO rent yet. Completes when accrued >= cost, then
 *              becomes a villa.
 *  - villa:    a finished villa. Pays monthly rent (the coin). */
export type TileType = 'land' | 'building' | 'villa';
export type Variant = 'conservative' | 'balanced' | 'aggressive';

/** Whose town this is. */
export interface Profile {
  name: string;
  city: string;
  /** Optional phone number. */
  phone?: string;
  /** Optional owner photo, stored as a data URL. Shown as the corner avatar. */
  photo?: string;
}

export interface Tile {
  id: string;
  type: TileType;
  variant: Variant;
  cost: number;            // ticket / target value of this tile
  sipMonthly: number;      // monthly SIP (building only; 0 otherwise)
  sipAccrued: number;      // amount accrued so far (building)
  rentMonthly: number;     // monthly rent (villa only; 0 otherwise)
  boughtAt: number;        // epoch ms
  label: string;           // e.g. "Kelambakkam Grove"
}

// v2: reset the board once to the lean starter (the v1 store had accumulated
// many test tiles). Bumping the key means old v1 tiles are ignored and the
// starter seeds fresh on the next load.
const STORE_KEY = 'estate_tiles_v2';
const RENT_KEY = 'estate_rent_collected_v1';
const PROFILE_KEY = 'estate_profile_v1';
/** Set once the starter tiles have been seeded, so we never re-seed over a
 *  user who has since cleared their own plots. */
const SEEDED_KEY = 'estate_seeded_v2';

/**
 * A small starter estate: one of each kind (villa, land, under-construction),
 * so the board shows all three categories with plenty of open plots left for
 * the user to fill. Seeded once on first run only.
 */
function starterTiles(): Tile[] {
  const now = 1_760_000_000_000; // fixed stamp so history/growth are stable
  return [
    {
      id: 'seed-villa', type: 'villa', variant: 'balanced',
      cost: 30_00_000, sipMonthly: 0, sipAccrued: 0,
      rentMonthly: Math.round((30_00_000 * 0.06) / 12),
      boughtAt: now - 120 * 86_400_000, label: 'Green Villa',
    },
    {
      id: 'seed-land', type: 'land', variant: 'aggressive',
      cost: 20_00_000, sipMonthly: 0, sipAccrued: 0, rentMonthly: 0,
      boughtAt: now - 80 * 86_400_000, label: 'Kelambakkam Grove',
    },
    {
      id: 'seed-build', type: 'building', variant: 'balanced',
      cost: 40_00_000, sipMonthly: 25_000, sipAccrued: 6_00_000, rentMonthly: 0,
      boughtAt: now - 40 * 86_400_000, label: 'Hillview Build',
    },
  ];
}

/** Plots available around the town hall. The board is large and the map
 *  scrolls freely, so there is always room to keep building. */
export const TOTAL_PLOTS = 120;

@Injectable({ providedIn: 'root' })
export class EstateService {
  /** Owned tiles, newest last. A signal so the estate re-renders on change. */
  readonly tiles = signal<Tile[]>(this.load());
  /** Lifetime rent collected (tapping the coin adds the pending rent). */
  readonly rentCollected = signal<number>(this.loadRent());
  /** Whose town this is, and where. Used for the home greeting. */
  readonly profile = signal<Profile>(this.loadProfile());

  // ---------------- persistence ----------------
  private load(): Tile[] {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw) as Tile[];
      // first run: seed a small starter estate (once), so the board shows all
      // three kinds with open plots left over. Never re-seeds afterwards.
      if (!localStorage.getItem(SEEDED_KEY)) {
        const seed = starterTiles();
        localStorage.setItem(STORE_KEY, JSON.stringify(seed));
        localStorage.setItem(SEEDED_KEY, '1');
        return seed;
      }
      return [];
    } catch {
      return [];
    }
  }
  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.tiles()));
    } catch {}
  }
  private loadRent(): number {
    try {
      return Number(localStorage.getItem(RENT_KEY) || 0);
    } catch {
      return 0;
    }
  }
  private saveRent(): void {
    try {
      localStorage.setItem(RENT_KEY, String(this.rentCollected()));
    } catch {}
  }
  private loadProfile(): Profile {
    const fallback: Profile = { name: 'Sanjeev', city: 'Chennai' };
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Profile>) } : fallback;
    } catch {
      return fallback;
    }
  }
  setProfile(p: Partial<Profile>): void {
    this.profile.update((cur) => ({ ...cur, ...p }));
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile()));
    } catch {}
  }

  // ---------------- derived counts ----------------
  get openPlots(): number {
    return Math.max(0, TOTAL_PLOTS - this.tiles().length);
  }
  countOf(t: TileType): number {
    return this.tiles().filter((x) => x.type === t).length;
  }

  /** Sum of monthly rent from finished villas — the "Rent in" chip. */
  get rentIn(): number {
    return this.tiles().filter((t) => t.type === 'villa').reduce((s, t) => s + t.rentMonthly, 0);
  }
  /** Sum of active SIPs on villas under construction — the "Build cost" chip. */
  get buildCost(): number {
    return this.tiles().filter((t) => t.type === 'building').reduce((s, t) => s + t.sipMonthly, 0);
  }

  /** Total worth of the estate today: finished villas and land at full value,
   *  plus only what has actually accrued so far on villas still building. */
  get estateValue(): number {
    return this.tiles().reduce(
      (s, t) => s + (t.type === 'building' ? t.sipAccrued : t.cost),
      0,
    );
  }

  /** Yearly rent as an income figure (12 x the monthly "rent in"). */
  get rentYearly(): number {
    return this.rentIn * 12;
  }

  // ---------------- mutations ----------------
  addTile(input: Omit<Tile, 'id' | 'boughtAt'>): Tile {
    const tile: Tile = {
      ...input,
      id: 'tile_' + Math.random().toString(36).slice(2, 9),
      boughtAt: Date.now(),
    };
    this.tiles.update((list) => [...list, tile]);
    this.save();
    return tile;
  }

  removeTile(id: string): void {
    this.tiles.update((list) => list.filter((t) => t.id !== id));
    this.save();
  }

  /**
   * Start a SIP on a land plot to build a villa on it. The land becomes an
   * under-construction tile: a monthly SIP accrues toward the target villa
   * cost, and the plot renders as a build in progress on the map. The land's
   * existing value carries over as the first accrual so nothing is lost.
   */
  convertLandToVilla(id: string, sipMonthly: number, targetCost: number): void {
    this.tiles.update((list) =>
      list.map((t) =>
        t.id === id && t.type === 'land'
          ? {
              ...t,
              type: 'building' as TileType,
              sipMonthly,
              sipAccrued: t.cost,   // the land's worth is the starting balance
              cost: targetCost,     // the villa we're building toward
              rentMonthly: 0,
            }
          : t,
      ),
    );
    this.save();
  }

  /** Collect the pending rent (all villas' monthly rent, once). */
  collectRent(): number {
    const amt = this.rentIn;
    if (amt <= 0) return 0;
    this.rentCollected.update((v) => v + amt);
    this.saveRent();
    return amt;
  }

  /** Building progress 0..1 toward the villa's cost. */
  buildProgress(t: Tile): number {
    if (t.type !== 'building' || t.cost <= 0) return t.type === 'villa' ? 1 : 0;
    return Math.max(0, Math.min(1, t.sipAccrued / t.cost));
  }
}
