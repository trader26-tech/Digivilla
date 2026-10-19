import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { BookingService } from '../booking.service';
import { EstateService } from '../estate.service';

/** ── the Goals tab's data (GET /me/goals) — everything on real records ──
 *  villas       the client's villas by the shared allocation rule, each with its category
 *  monthly      finished villas × the estate's income per villa (calculator settings)
 *  payouts      every payout actually received (money-out lines of the report), by month
 *  goals        the saved Homecoming plan and custom goals (admin_config goals:<code>) */
export type VillaCategory = 'conservative' | 'balanced' | 'aggressive';
export interface GoalVilla { id: string | null; name: string; building: boolean; invested: number; since: string | null; type: VillaCategory | null; }
export interface Payout { month: string; date: string; amount: number; lines: number; villas: number; }
export interface CustomGoal {
  id: string; kind: string; name: string; amount: number;
  /** 0 one time · 1 every year · 2 every month */
  type: 0 | 1 | 2;
  /** months ahead (one time) or month index 0–11 (every year) */
  m: number; villas: number; created: string;
}
export interface SavedGoals { homecoming?: { total?: number; parts?: number[]; funded?: boolean }; custom?: CustomGoal[]; }
export interface GoalsOverview {
  payday: number; villa_cost: number; income_per_villa: number; next_payday: string; client_code: string | null;
  villas: GoalVilla[]; owned: number; building: number; by_type: Record<VillaCategory, number>; untyped: number;
  monthly: number; payouts: Payout[]; received: number; payout_count: number; goals: SavedGoals;
}

export type GoalsPage = 'hub' | 'payout' | 'trip-builder' | 'trip-fund' | 'create';
/** the four parts of the yearly trip, in the design's order: flights · outings · shopping · vacation */
export const TRIP_DEFAULT = [24000, 16000, 64000, 46000];
const LS = 'dv_goals_v1';

@Injectable({ providedIn: 'root' })
export class GoalsService {
  private http = inject(HttpClient);
  private est = inject(EstateService);
  private auth = inject(AuthService);
  private booking = inject(BookingService);
  private get headers(): Record<string, string> { const t = this.auth.token(); return t ? { Authorization: `Bearer ${t}` } : {}; }

  readonly data = signal<GoalsOverview | null>(null);
  readonly error = signal(false);
  private inflight = false;

  /** which screen of the flow is showing */
  readonly page = signal<GoalsPage>('hub');
  /** the Homecoming plan: a typed yearly amount (0 = use the 4-part estimate) and the 4 parts */
  readonly tripTotal = signal<number>(0);
  readonly tripParts = signal<number[]>([...TRIP_DEFAULT]);
  readonly custom = signal<CustomGoal[]>([]);

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || 'null') as SavedGoals | null;
      if (s) this.applySaved(s);
    } catch { /* first visit */ }
  }

  // ── derived figures every screen shares ──
  readonly villaCost = computed(() => this.data()?.villa_cost ?? 500000);
  readonly perVillaMonth = computed(() => this.data()?.income_per_villa ?? 1500);
  readonly perVillaYear = computed(() => this.perVillaMonth() * 12);
  readonly payday = computed(() => this.data()?.payday ?? 5);
  readonly owned = computed(() => this.data()?.owned ?? 0);
  readonly monthly = computed(() => this.data()?.monthly ?? this.owned() * this.perVillaMonth());
  readonly tripEstimate = computed(() => this.tripParts().reduce((a, b) => a + b, 0));
  /** the amount the Homecoming card shows: the typed total, else the 4-part estimate */
  readonly tripAmount = computed(() => this.tripTotal() || this.tripEstimate());
  readonly nextPayday = computed(() => {
    const d = this.data()?.next_payday;
    if (d) return new Date(d + 'T12:00:00');
    const now = new Date(), p = this.payday();
    return new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= p ? 1 : 0), p);
  });

  /** villas needed: a monthly target, a yearly target, or a one-time target by month m from now */
  villasForMonthly(target: number): number { return Math.max(1, Math.ceil(target / this.perVillaMonth())); }
  villasForYearly(target: number): number { return Math.max(1, Math.ceil(target / this.perVillaYear())); }
  villasForOneTime(target: number, months: number): number { return Math.max(1, Math.ceil(target / (this.perVillaMonth() * Math.max(1, months)))); }

  load(force = false): void {
    if (this.inflight || (this.data() && !force)) return;
    this.inflight = true; this.error.set(false);
    this.http.get<GoalsOverview>(`${environment.apiUrl}/me/goals`, { headers: this.headers }).subscribe({
      next: (d) => { this.inflight = false; this.data.set(d); if (d.goals && Object.keys(d.goals).length) this.applySaved(d.goals); },
      error: () => { this.inflight = false; this.error.set(true); },
    });
  }
  private applySaved(s: SavedGoals): void {
    if (s.homecoming) {
      if (Array.isArray(s.homecoming.parts) && s.homecoming.parts.length === 4) this.tripParts.set(s.homecoming.parts.map((x) => Math.max(0, Math.round(x))));
      if (typeof s.homecoming.total === 'number') this.tripTotal.set(Math.max(0, Math.round(s.homecoming.total)));
    }
    if (Array.isArray(s.custom)) this.custom.set(s.custom);
  }
  /** persist the plan: this device at once, the account in the background */
  save(): void {
    const body: SavedGoals = { homecoming: { total: this.tripTotal(), parts: this.tripParts() }, custom: this.custom() };
    try { localStorage.setItem(LS, JSON.stringify(body)); } catch { /* private mode */ }
    this.http.put<SavedGoals>(`${environment.apiUrl}/me/goals`, body, { headers: this.headers }).subscribe({ next: () => {}, error: () => {} });
  }
  setTripTotal(v: number): void { this.tripTotal.set(Math.max(0, Math.min(99_999_999, Math.round(v || 0)))); this.save(); }
  setTripParts(parts: number[]): void { this.tripParts.set(parts.map((x) => Math.max(0, Math.min(99_999_999, Math.round(x || 0))))); this.save(); }
  addCustom(g: Omit<CustomGoal, 'id' | 'created'>): CustomGoal {
    const goal: CustomGoal = { ...g, id: Math.random().toString(36).slice(2, 10), created: new Date().toISOString() };
    this.custom.set([goal, ...this.custom()]); this.save();
    return goal;
  }
  removeCustom(id: string): void { this.custom.set(this.custom().filter((g) => g.id !== id)); this.save(); }

  /** "Pay": a buy request for N villas of a category, through the same booking flow the
   *  estate uses (the team completes the purchase; nothing is charged in the app). */
  requestVillas(villas: number, category: VillaCategory | null, note: string): Observable<unknown> {
    const p = this.est.profile();
    const name = category ? category[0].toUpperCase() + category.slice(1) : 'Balanced';
    return this.booking.createRequest({
      name: p.name || 'Client', phone: p.phone || '', kind: 'buy', property: `${villas} × ${name} DigiVilla`, variant: name,
      amount: villas * this.villaCost(), note,
    }).pipe(tap(() => this.load(true)));
  }

  // ── formatting shared by the screens (the design's rules) ──
  inr(n: number): string { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  lakh(n: number): string {
    if (n >= 1e7) return '₹' + (+(n / 1e7).toFixed(2)) + ' Cr';
    if (n >= 1e5) return '₹' + (+(n / 1e5).toFixed(2)) + ' lakh';
    return this.inr(n);
  }
  lakhShort(n: number): string {
    if (n >= 1e7) return '₹' + (+(n / 1e7).toFixed(2)) + ' Cr';
    if (n >= 1e5) return '₹' + (+(n / 1e5).toFixed(2)) + 'L';
    return this.inr(n);
  }
}
