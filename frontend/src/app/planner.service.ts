import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import {
  AuthResponse,
  Basket,
  BasketCreate,
  BasketSuggestResponse,
  BasketMetrics,
  DashboardOverview,
  FundDetail,
  FundInfo,
  FundListResponse,
  Goal,
  GoalCreate,
  GoalPreset,
  ModelBasket,
  NavHistoryResponse,
  PlanRequest,
  PlanResponse,
} from './models';

@Injectable({ providedIn: 'root' })
export class PlannerService {
  private readonly base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /** The signed-in user's owner id (set at login); falls back to a stable
   *  per-browser id so the app still works before/without login. */
  get owner(): string {
    let id = localStorage.getItem('wp_owner');
    if (!id) {
      id = 'usr_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('wp_owner', id);
    }
    return id;
  }

  // --- Auth ---------------------------------------------------------------
  signup(email: string, password: string, name: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.base}/auth/signup`, { email, password, name });
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.base}/auth/login`, { email, password });
  }

  presets(): Observable<GoalPreset[]> {
    return this.http.get<GoalPreset[]>(`${this.base}/presets`);
  }

  plan(req: PlanRequest): Observable<PlanResponse> {
    return this.http.post<PlanResponse>(`${this.base}/plan`, req);
  }

  // --- Dashboard ----------------------------------------------------------
  overview(): Observable<DashboardOverview> {
    return this.http.get<DashboardOverview>(`${this.base}/dashboard/overview`);
  }

  funds(opts: {
    bucket?: string;
    q?: string;
    asset_class?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }): Observable<FundListResponse> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return this.http.get<FundListResponse>(`${this.base}/dashboard/funds`, { params });
  }

  fundDetail(schemeCode: number): Observable<FundDetail> {
    return this.http.get<FundDetail>(`${this.base}/dashboard/funds/${schemeCode}`);
  }

  navHistory(schemeCode: number): Observable<NavHistoryResponse> {
    return this.http.get<NavHistoryResponse>(
      `${this.base}/dashboard/funds/${schemeCode}/nav`,
    );
  }

  fundInfo(schemeCode: number): Observable<FundInfo> {
    return this.http.get<FundInfo>(`${this.base}/dashboard/funds/${schemeCode}/info`);
  }

  analyzeBasket(
    items: { scheme_code: number; weight: number }[],
    includeSeries = false,
  ): Observable<BasketMetrics> {
    return this.http.post<BasketMetrics>(`${this.base}/baskets/analyze`, {
      items,
      include_series: includeSeries,
    });
  }

  modelBaskets(): Observable<ModelBasket[]> {
    return this.http.get<ModelBasket[]>(`${this.base}/baskets/models`);
  }

  deriveBasket(prefs: Record<string, number>): Observable<BasketSuggestResponse> {
    return this.http.post<BasketSuggestResponse>(`${this.base}/baskets/derive`, prefs);
  }

  // --- Baskets ------------------------------------------------------------
  suggestBasket(risk: string): Observable<BasketSuggestResponse> {
    return this.http.post<BasketSuggestResponse>(`${this.base}/baskets/suggest`, { risk });
  }

  baskets(goalId?: string): Observable<Basket[]> {
    let params = new HttpParams().set('owner', this.owner);
    if (goalId) params = params.set('goal_id', goalId);
    return this.http.get<Basket[]>(`${this.base}/baskets`, { params });
  }

  saveBasket(b: BasketCreate): Observable<Basket> {
    return this.http.post<Basket>(`${this.base}/baskets`, { ...b, owner: this.owner });
  }

  updateBasket(id: string, b: BasketCreate): Observable<Basket> {
    return this.http.put<Basket>(`${this.base}/baskets/${id}`, { ...b, owner: this.owner });
  }

  deleteBasket(id: string): Observable<{ status: string }> {
    const params = new HttpParams().set('owner', this.owner);
    return this.http.delete<{ status: string }>(`${this.base}/baskets/${id}`, { params });
  }

  // --- Goals --------------------------------------------------------------
  goals(): Observable<Goal[]> {
    const params = new HttpParams().set('owner', this.owner);
    return this.http.get<Goal[]>(`${this.base}/goals`, { params });
  }

  saveGoal(goal: GoalCreate): Observable<Goal> {
    return this.http.post<Goal>(`${this.base}/goals`, { ...goal, owner: this.owner });
  }

  deleteGoal(id: string): Observable<{ status: string }> {
    const params = new HttpParams().set('owner', this.owner);
    return this.http.delete<{ status: string }>(`${this.base}/goals/${id}`, { params });
  }
}
