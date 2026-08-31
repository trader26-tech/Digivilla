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

const STORE_KEY = 'estate_tiles_v1';
const RENT_KEY = 'estate_rent_collected_v1';
const PROFILE_KEY = 'estate_profile_v1';

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
      return raw ? (JSON.parse(raw) as Tile[]) : [];
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
