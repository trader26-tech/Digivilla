import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { environment } from '../environments/environment';
import { AuthService } from './auth/auth.service';

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

/** One fund inside a villa's mix. */
export interface VillaFundMix { fund_name: string; role: string; weight: number; }
/** A villa tier shown on the Explore page (from /villas/catalog). */
export interface VillaTier {
  id: string;
  name: string;
  price: number;
  monthly_income: number;
  growth_rate: number;
  projection: Record<string, number>;   // "5" | "10" | "15" | "20" → value
  multiple_20y: number;
  funds: VillaFundMix[];
}

/** One canonical "Villa SIP" in the list (from /villas/sip). */
export interface VillaSipItem {
  id: string;
  name: string;
  tier?: string;
  /** 'sip' | 'lumpsum' — the bucket's investing mechanic. */
  kind?: string;
  /** e.g. "medium risk portfolio" (may be null/absent). */
  subtitle?: string;
  fund_count: number;
}
/** One fund row inside a Villa SIP mix. Returns may be null (no history). */
export interface VillaSipFund {
  scheme_name: string;
  scheme_code?: string;
  category: string;
  allocation: number;          // a percent, e.g. 36
  ret_1y: number | null;
  ret_3y: number | null;
  ret_5y: number | null;
}
/** A single Villa SIP with its funds + blended overall returns (from /villas/sip/{id}). */
export interface VillaSipDetail {
  id: string;
  name: string;
  tier?: string;
  /** 'sip' | 'lumpsum' — the bucket's investing mechanic. */
  kind?: string;
  /** e.g. "medium risk portfolio" (may be null/absent). */
  subtitle?: string;
  allocation_total: number;
  funds: VillaSipFund[];
  overall: {
    ret_1y: number | null;
    ret_3y: number | null;
    ret_5y: number | null;
  };
}

/** One account transaction (from GET /me/transactions). */
export interface AccountTxn {
  date: string;
  kind: string;            // 'sip' | 'lump_sum' | 'rent'
  amount: number;
  direction: 'in' | 'out';
  villa: string;
  status: string;
}

export interface Tile {
  id: string;
  type: TileType;
  variant: Variant;
  cost: number;            // ticket / target value of this tile
  sipMonthly: number;      // monthly SIP (building only; 0 otherwise)
  sipAccrued: number;      // amount accrued so far (building)
  rentMonthly: number;     // monthly rent (villa only; 0 otherwise)
  currentValue?: number;   // real live value (Σ units × NAV) for real holdings
  boughtAt: number;        // epoch ms
  label: string;           // e.g. "Kelambakkam Grove"
}

/** Real portfolio net worth, from GET /me/portfolio (client_holdings × live NAV). */
export interface PortfolioSummary {
  worth: number;
  invested: number;
  gain: number;
  gain_pct: number;
  total_swp: number;
  holdings_count: number;
  has_holdings: boolean;
  client_code: string | null;
  /** The name to greet with — server-derived from the client's real record, or
   *  the user's custom override. May be "". */
  estate_name: string;
  /** The user's custom city / nickname for their estate. May be "". */
  estate_city: string;
}

// v2: reset the board once to the lean starter (the v1 store had accumulated
// many test tiles). Bumping the key means old v1 tiles are ignored and the
// starter seeds fresh on the next load.
const STORE_KEY = 'estate_tiles_v2';
const PROFILE_KEY = 'estate_profile_v1';

/** Plots available around the town hall. The board is large and the map
 *  scrolls freely, so there is always room to keep building. */
export const TOTAL_PLOTS = 120;

@Injectable({ providedIn: 'root' })
export class EstateService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  /** Owned tiles, newest last. A signal so the estate re-renders on change.
   *  A brand-new account starts EMPTY (no fake starter tiles). */
  readonly tiles = signal<Tile[]>(this.load());
  /** Authoritative real net worth from the server (client_holdings × live NAV).
   *  Null until loaded; the tile-derived getters are the offline fallback. */
  readonly portfolio = signal<PortfolioSummary | null>(null);
  /** Whose town this is, and where. Used for the home greeting. */
  readonly profile = signal<Profile>(this.loadProfile());

  constructor() {
    // When signed in, the DB is the source of truth: load this user's real
    // estate (empty for a new account) and keep localStorage only as a cache.
    if (this.auth.token()) this.syncFromServer();
    // Re-sync whenever the app is brought back to the foreground, so a villa the
    // advisor just mapped (or SIP recorded) shows up without a manual refresh.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.auth.token()) this.syncFromServer();
      });
    }
  }

  private get authHeaders(): Record<string, string> {
    const t = this.auth.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  /** The villa tiers for the Explore page (public catalog) — price, monthly
   *  income, growth projection and fund mix. */
  catalog(): import('rxjs').Observable<{ villas: VillaTier[] }> {
    return this.http.get<{ villas: VillaTier[] }>(`${environment.apiUrl}/villas/catalog`);
  }

  /** The canonical Villa SIP list — id, name, tier and fund count. */
  villaSipList(): import('rxjs').Observable<{ villas: VillaSipItem[] }> {
    return this.http.get<{ villas: VillaSipItem[] }>(`${environment.apiUrl}/villas/sip`);
  }

  /** One Villa SIP with its full fund mix + blended overall returns. */
  villaSip(id: string): import('rxjs').Observable<VillaSipDetail> {
    return this.http.get<VillaSipDetail>(`${environment.apiUrl}/villas/sip/${id}`);
  }

  /** Every transaction on the account (SIP, lump-sum, rent/SWP), newest first. */
  transactions(): import('rxjs').Observable<{ transactions: AccountTxn[] }> {
    return this.http.get<{ transactions: AccountTxn[] }>(
      `${environment.apiUrl}/me/transactions`, { headers: this.authHeaders });
  }

  /** Pull this user's estate + real net worth from the backend. */
  syncFromServer(): void {
    const t = this.auth.token();
    if (!t) return;
    this.http.get<{ tiles: Tile[] }>(`${environment.apiUrl}/me/estate`, { headers: this.authHeaders })
      .subscribe({
        next: (r) => {
          this.tiles.set(r.tiles || []);
          this.cacheLocal();
        },
        error: () => { /* offline — keep the local cache */ },
      });
    this.loadPortfolio();
  }

  /** Authoritative real net worth (client_holdings × live NAV). */
  loadPortfolio(): void {
    if (!this.auth.token()) return;
    this.http.get<PortfolioSummary>(`${environment.apiUrl}/me/portfolio`, { headers: this.authHeaders })
      .subscribe({
        next: (p) => this.portfolio.set(p),
        error: () => { /* keep the tile-derived fallback */ },
      });
  }

  /** The greeting name from the server (real record or the user's override). */
  get estateName(): string { return this.portfolio()?.estate_name || ''; }
  /** The user's custom city / nickname for their estate, from the server. */
  get estateCity(): string { return this.portfolio()?.estate_city || ''; }

  /** Save the user's estate-name / city edits. On success the resolved values
   *  come back (an empty field clears to the server default) and are merged into
   *  the portfolio signal in place, so the greeting updates live. Fails silently. */
  saveEstateProfile(patch: { estate_name?: string; estate_city?: string }): void {
    if (!this.auth.token()) return;
    this.http
      .patch<{ estate_name: string; estate_city: string }>(
        `${environment.apiUrl}/me/profile`, patch, { headers: this.authHeaders },
      )
      .subscribe({
        next: (res) => this.portfolio.update((p) => (p ? { ...p, ...res } : p)),
        error: () => { /* silent — keep the current greeting */ },
      });
  }

  /** Push the current estate to the backend (fire-and-forget). */
  private pushToServer(): void {
    if (!this.auth.token()) return;
    this.http.put(`${environment.apiUrl}/me/estate`, { tiles: this.tiles() },
      { headers: this.authHeaders }).subscribe({ next: () => {}, error: () => {} });
  }

  // ---------------- persistence ----------------
  private load(): Tile[] {
    // Local cache only — NO fake seeding. New accounts start empty; the real
    // estate is loaded from the server in the constructor when signed in.
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Tile[]) : [];
    } catch {
      return [];
    }
  }
  private cacheLocal(): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.tiles())); } catch {}
  }
  private save(): void {
    this.cacheLocal();
    this.pushToServer();
  }
  private loadProfile(): Profile {
    // No fake demo identity — a fresh user has no name until the advisor sets
    // it up on the first call. The greeting handles an empty name gracefully.
    const fallback: Profile = { name: '', city: '', phone: '' };
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

  /** Total invested — the money actually put in (Σ per-tile cost). Prefers the
   *  authoritative server figure, falling back to the tiles when offline. */
  get invested(): number {
    const p = this.portfolio();
    if (p) return p.invested;
    return this.tiles().reduce((s, t) => s + (t.cost || 0), 0);
  }

  /** Live gain = current worth − invested (can be negative). Real, not rent. */
  get gain(): number {
    const p = this.portfolio();
    if (p) return p.gain;
    return this.estateValue - this.invested;
  }

  /** Total SWP paid out to the user so far (Σ paid income/rent), from server. */
  get totalSwp(): number { return this.portfolio()?.total_swp ?? 0; }

  /** Gain as a percentage of invested. */
  get gainPct(): number {
    const p = this.portfolio();
    if (p) return p.gain_pct;
    const inv = this.invested;
    return inv ? (this.gain / inv) * 100 : 0;
  }

  /** Total worth today: real live value (Σ units × NAV) per tile, falling back
   *  to invested for legacy tiles that carry no currentValue. Prefers the
   *  authoritative server figure. */
  get estateValue(): number {
    const p = this.portfolio();
    if (p) return p.worth;
    return this.tiles().reduce(
      (s, t) => s + (t.currentValue ?? (t.type === 'building' ? t.sipAccrued : t.cost)),
      0,
    );
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

  /** Building progress 0..1 toward the villa's cost. */
  buildProgress(t: Tile): number {
    if (t.type !== 'building' || t.cost <= 0) return t.type === 'villa' ? 1 : 0;
    return Math.max(0, Math.min(1, t.sipAccrued / t.cost));
  }
}
