import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

export type RequestKind = 'consultation' | 'sip' | 'buy' | 'withdraw';

export interface Booking {
  id: string;
  name: string;
  phone: string;
  kind: RequestKind;
  property: string;
  variant: string;
  plots: number;
  amount: number;
  slot: string; // ISO-8601 (consultation only)
  note: string;
  status: 'requested' | 'confirmed' | 'declined';
  meet_link?: string;   // Google Meet / video link for the session
  created_at: string;
}

/** /admin/market/performance — daily closes on one shared calendar (null before a series starts). */
export interface MarketData {
  as_of: string | null;
  days: string[];
  series: Record<string, { name: string; values: (number | null)[] }>;
  villas: { key: string; name: string; risk_name?: string; weights: Record<string, number> }[];
  default_villa?: string;
  rebalance?: { parts: string[]; month: number };
  benchmarks: { key: string; label: string; about: string }[];
  first_investment: string | null;
  /** the ACTUAL funds in the villa buckets: NAV on each of `days` (null before the first NAV) */
  funds?: MarketFund[];
  /** each villa's real composition: sleeve → funds with weights (normalised per sleeve) */
  villa_funds?: Record<string, Record<string, { scheme_code: number; weight: number }[]>>;
  sources?: { index: string; funds: string };
}
export interface MarketFund {
  key: string; scheme_code: number; name: string; short: string; sleeve: string; villas: string[];
  values: (number | null)[]; since: string | null; ok: boolean;
}

export interface SessionInfo {
  device_known: boolean;
  has_pin: boolean;
  email: string | null;
  signin_email: string;
  lock_minutes: number;
  lock_presets: number[];
}

export interface TokenResponse {
  access_token: string;
  expires_at: number;
  lock_minutes: number;
  has_pin?: boolean;
  email?: string;
  lock_presets?: number[];
  /** trusted-device credential (verify-otp / unlock) — kept as a cookie fallback */
  device_token?: string;
}

export interface AvailabilityConfig {
  start: string;
  end: string;
  slot_minutes: number;
  weekdays: number[];
  tz_offset: string;
  busy_times: string[];   // "HH:MM" slots busy EVERY day (recurring)
}
export interface DaySlot {
  time: string; // "HH:MM"
  slot: string; // ISO-8601
  blocked: boolean;
  recurring?: boolean;    // true when busy because of a recurring busy_time
}
export interface AvailabilityDay {
  date: string; // YYYY-MM-DD
  weekday: number;
  slots: DaySlot[];
}
export interface AvailabilityResponse {
  config: AvailabilityConfig;
  days: AvailabilityDay[];
}

export interface ClientFolder {
  client: string;
  count: number;
  updated: string;
}

/** A row in the Clients list (light summary). */
export interface ClientRow {
  id: string;
  name: string;
  phone: string;
  city: string;
  villa_count: number;
  invested: number;
  pending: number;
}
/** One villa a client owns / is building. */
export interface ClientHolding {
  id: string;
  villa_name: string;
  villa_id: string;
  status: string;              // accumulating | active | exited
  price: number;
  invested: number;
  progress: number | null;     // 0..1 toward the villa price
  current_value: number;
  rent_received: number;
  monthly_income: number;
  sip_monthly: number;
  sip_next_payment: string | null;
  funds: ClientFund[];
}
/** A villa in the catalogue the admin can assign to a client. */
export interface VillaCatalogItem {
  id: string;
  name: string;
  price: number;
  rent_monthly: number;
  target_growth: number;
}
/** One fund inside a villa (the concentration). */
export interface ClientFund {
  fund_name: string;
  scheme_code: number;
  weight: number;        // 0..1 of the villa
  role: string;          // income | growth | liquid | hedge
  value: number;         // this client's ₹ in this fund
  withdraw_monthly: number;
}
/** A row in a client's money ledger. */
export interface ClientLedgerRow {
  id: string;
  villa_name: string;
  kind: string;                // sip | lump_sum | rent | withdrawal
  amount: number;
  date: string;
  status: string;
  note: string;
}
/** The full client profile shown when a client is opened. */
export interface ClientProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  age: number | null;
  summary: {
    invested: number;
    current_value: number;
    rent_received: number;
    monthly_income: number;
    sip_monthly: number;
    villa_count: number;
  };
  holdings: ClientHolding[];
  ledger: ClientLedgerRow[];
  requests: Booking[];
  documents: ClientDoc[];
}
export interface ClientDoc {
  id: string;
  client: string;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
}

/** One fund on the Commission page: money held across clients, its trail rate, what it earns. */
export interface CommissionFund {
  key: string;                 // scheme code, or "name:…" when the report had none
  scheme_code: number | null;
  scheme_name: string;
  aum: number;                 // ₹ held today at live NAV (demo client excluded)
  invested: number;
  clients: number;
  in_villa: boolean;
  nav_date: string | null;
  rate_pct: number | null;     // trail commission, % a year (null = not set)
  yearly: number;
  monthly: number;
}
export interface CommissionOverview {
  as_of: string;
  updated_at: string | null;
  max_rate_pct: number;
  funds: CommissionFund[];
  totals: {
    aum: number; aum_with_rate: number; yearly: number; monthly: number;
    avg_rate_pct: number | null; funds: number; funds_missing_rate: number; clients: number;
  };
}

/** /admin/meet — the one Meet room, the admin's own meetings, and calls clients booked in the app. */
export interface MeetRoom { url: string; is_default: boolean; updated_at: string | null; }
export interface Meeting {
  id: string;
  title: string;
  with_name: string;
  with_phone?: string;
  client_code?: string | null;
  starts_at: string;          // ISO with offset
  duration_min: number;
  note: string;
  status: 'scheduled' | 'done' | 'cancelled';
  created_at: string;
  updated_at: string;
}
export interface ClientCall { id: string; name: string; phone: string; starts_at: string; status: string; note: string; }
export interface MeetOverview { room: MeetRoom; meetings: Meeting[]; client_calls: ClientCall[]; }

/** Villas sold, by type. */
export type VillaType = 'conservative' | 'balanced' | 'aggressive';
export interface VillaTypeRow { key: VillaType; name: string; risk: string; count: number; constructed: number; value: number; invested: number; commission: number; }
export interface VillaSummary {
  types: VillaTypeRow[];
  unset: { count: number; value: number; villas: { villa_id: string; client_code: string; client_name: string; name: string; value: number }[] };
  totals: { count: number; value: number; commission: number };
}
/** World markets today (Yahoo, cached on the server). */
export interface WorldQuote {
  key: string; symbol: string; name: string; region: string; currency: string | null;
  /** 'yield' = a bond yield in % a year (moves in basis points); unit e.g. '$/bbl' */
  kind?: string | null; change_bp?: number | null; unit?: string;
  last: number | null; prev_close: number | null; change: number | null; change_pct: number | null;
  /** in US dollars: local move combined with the currency's move against the dollar */
  usd_last: number | null; usd_prev: number | null; usd_change_pct: number | null; fx_pct: number | null;
  day_high: number | null; day_low: number | null; high_52w: number | null; low_52w: number | null;
  time: number | null; tz: string | null; spark: number[];
  /** an emoji flag for the table; the exchange-local date of the latest price and of the close it is compared with */
  flag?: string; session?: string | null; prev_date?: string | null;
}
export interface WorldQuotes { regions: string[]; indices: WorldQuote[]; as_of: number; }
/** /admin/world/history — d = day number since 1970-01-01 (UTC), v = close (own currency), u = close in US$ */
export interface WorldHistory { key: string; name: string; region: string; kind?: string | null; currency: string | null; d: number[]; v: number[]; u: (number | null)[]; }
/** monthly consumer-price levels (d = day number of the 1st of each month) */
export interface CpiSeries { name: string; source: string; d: number[]; v: number[]; last_actual: number; latest_yoy: number | null; estimated_from: number | null; }
export interface WorldCpi { US: CpiSeries; IN: CpiSeries; }
export interface WorldChart { key: string; name: string; range: string; currency: string | null; local_currency?: string | null; prev_close: number | null; points: [number, number][]; }

const AT = 'ml_admin_at';       // access token
const AT_EXP = 'ml_admin_at_exp';
// Copy of the trusted-device credential (the httpOnly cookie is the primary).
// Sent as X-Admin-Device so a browser that drops the cookie still skips the email code.
const DEV = 'ml_admin_device';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  // ── access token (bearer on every /admin call) ────────────────────────────
  get token(): string {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(AT)) || '';
  }
  get storedExp(): number {
    return Number((typeof localStorage !== 'undefined' && localStorage.getItem(AT_EXP)) || 0) || 0;
  }
  store(token: string, exp: number): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AT, token);
    localStorage.setItem(AT_EXP, String(exp));
  }
  clearToken(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(AT);
    localStorage.removeItem(AT_EXP);
  }
  get deviceToken(): string {
    try { return localStorage.getItem(DEV) || ''; } catch { return ''; }
  }
  storeDevice(raw: string | undefined): void {
    if (!raw) return;
    try { localStorage.setItem(DEV, raw); } catch { /* ignore */ }
  }
  clearDevice(): void {
    try { localStorage.removeItem(DEV); } catch { /* ignore */ }
  }
  private get deviceOpts() {
    const d = this.deviceToken;
    const headers: Record<string, string> = d ? { 'X-Admin-Device': d } : {};
    return { headers, withCredentials: true };
  }
  private get authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }
  private get opts() {
    return { headers: this.authHeaders, withCredentials: true };
  }

  // ── auth flow ─────────────────────────────────────────────────────────────
  session(): Observable<SessionInfo> {
    return this.http.get<SessionInfo>(`${this.base}/admin/auth/session`, this.deviceOpts);
  }
  requestOtp(email = ''): Observable<{ ok: boolean; emailed: boolean; masked: string }> {
    return this.http.post<{ ok: boolean; emailed: boolean; masked: string }>(
      `${this.base}/admin/auth/request-otp`, { email }, { withCredentials: true });
  }
  verifyOtp(email: string, code: string): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(
      `${this.base}/admin/auth/verify-otp`, { email, code }, { withCredentials: true });
  }
  setPin(pin: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/admin/auth/set-pin`, { pin }, this.opts);
  }
  unlock(pin: string): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(
      `${this.base}/admin/auth/unlock`, { pin }, this.deviceOpts);
  }
  refresh(): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(`${this.base}/admin/auth/refresh`, {}, this.opts);
  }
  logoutDevice(): Observable<{ ok: boolean }> {
    const o = this.deviceOpts;
    return this.http.post<{ ok: boolean }>(`${this.base}/admin/auth/logout`, {},
      { ...o, headers: { ...o.headers, ...this.authHeaders } });
  }
  setLockMinutes(lock_minutes: number): Observable<{ ok: boolean; lock_minutes: number }> {
    return this.http.post<{ ok: boolean; lock_minutes: number }>(
      `${this.base}/admin/auth/settings`, { lock_minutes }, this.opts);
  }

  // ── bookings ──────────────────────────────────────────────────────────────
  listBookings(): Observable<Booking[]> {
    return this.http.get<Booking[]>(`${this.base}/admin/bookings`, this.opts);
  }
  setStatus(id: string, status: 'confirmed' | 'declined' | 'requested'): Observable<Booking> {
    return this.http.post<Booking>(`${this.base}/admin/bookings/${id}/status`, { status }, this.opts);
  }
  setMeetLink(id: string, meet_link: string): Observable<Booking> {
    return this.http.post<Booking>(`${this.base}/admin/bookings/${id}/meet`, { meet_link }, this.opts);
  }
  deleteBooking(id: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/bookings/${id}`, this.opts);
  }

  // ── availability ──────────────────────────────────────────────────────────
  availability(days = 14): Observable<AvailabilityResponse> {
    return this.http.get<AvailabilityResponse>(`${this.base}/admin/availability?days=${days}`, this.opts);
  }
  saveAvailabilityConfig(cfg: Partial<AvailabilityConfig>): Observable<{ config: AvailabilityConfig }> {
    return this.http.post<{ config: AvailabilityConfig }>(
      `${this.base}/admin/availability/config`, cfg, this.opts);
  }
  blockSlot(slot: string, blocked: boolean): Observable<{ ok: boolean; blocked: string[] }> {
    return this.http.post<{ ok: boolean; blocked: string[] }>(
      `${this.base}/admin/availability/block`, { slot, blocked }, this.opts);
  }

  // ── CRM: full client profiles ─────────────────────────────────────────────
  listCrmClients(): Observable<ClientRow[]> {
    return this.http.get<ClientRow[]>(`${this.base}/admin/crm/clients`, this.opts);
  }
  getCrmClient(id: string): Observable<ClientProfile> {
    return this.http.get<ClientProfile>(`${this.base}/admin/crm/clients/${id}`, this.opts);
  }
  seedSampleClients(): Observable<{ ok: boolean; seeded?: any; detail?: string }> {
    return this.http.post<{ ok: boolean; seeded?: any; detail?: string }>(
      `${this.base}/admin/crm/seed`, {}, this.opts);
  }
  // ── villa management (map villas to a client) ─────────────────────────────
  listVillas(): Observable<VillaCatalogItem[]> {
    return this.http.get<VillaCatalogItem[]>(`${this.base}/admin/crm/villas`, this.opts);
  }
  addHolding(userId: string, body: { villa_id: string; sip_monthly?: number; invested?: number; status?: string }):
    Observable<{ ok: boolean; detail?: string; profile?: ClientProfile }> {
    return this.http.post<{ ok: boolean; detail?: string; profile?: ClientProfile }>(
      `${this.base}/admin/crm/clients/${userId}/villas`, body, this.opts);
  }
  updateHolding(userId: string, uvId: string, patch: { sip_monthly?: number; current_value?: number; status?: string }):
    Observable<{ ok: boolean; detail?: string; profile?: ClientProfile }> {
    return this.http.put<{ ok: boolean; detail?: string; profile?: ClientProfile }>(
      `${this.base}/admin/crm/clients/${userId}/villas/${uvId}`, patch, this.opts);
  }
  deleteHolding(userId: string, uvId: string):
    Observable<{ ok: boolean; detail?: string; profile?: ClientProfile }> {
    return this.http.delete<{ ok: boolean; detail?: string; profile?: ClientProfile }>(
      `${this.base}/admin/crm/clients/${userId}/villas/${uvId}`, this.opts);
  }

  // ── client documents ──────────────────────────────────────────────────────
  listClients(): Observable<ClientFolder[]> {
    return this.http.get<ClientFolder[]>(`${this.base}/admin/clients`, this.opts);
  }
  createClient(name: string): Observable<ClientFolder> {
    return this.http.post<ClientFolder>(`${this.base}/admin/clients`, { name }, this.opts);
  }
  listDocuments(client: string): Observable<ClientDoc[]> {
    return this.http.get<ClientDoc[]>(
      `${this.base}/admin/documents?client=${encodeURIComponent(client)}`, this.opts);
  }
  uploadDocument(client: string, file: File): Observable<ClientDoc> {
    const fd = new FormData();
    fd.append('client', client);
    fd.append('file', file);
    return this.http.post<ClientDoc>(`${this.base}/admin/documents`, fd, this.opts);
  }
  /** Fetch a doc as a blob (Authorization header can't ride a plain link/anchor). */
  downloadDocument(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/admin/documents/${id}/download`, {
      ...this.opts, responseType: 'blob',
    });
  }
  deleteDocument(id: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/documents/${id}`, this.opts);
  }

  // ── daily reports → net worth & villa live pricing ───────────────────────
  uploadReport(reportType: 'user' | 'transaction', file: File, reportDate?: string):
    Observable<ReportUpload> {
    const fd = new FormData();
    fd.append('report_type', reportType);
    if (reportDate) fd.append('report_date', reportDate);
    fd.append('file', file);
    return this.http.post<ReportUpload>(`${this.base}/admin/reports/upload`, fd, this.opts);
  }
  // ── meeting room ─────────────────────────────────────────────────────────
  meet(): Observable<MeetOverview> {
    return this.http.get<MeetOverview>(`${this.base}/admin/meet`, this.opts);
  }
  /** empty url = back to the default room */
  setMeetRoom(url: string): Observable<MeetRoom> {
    return this.http.put<MeetRoom>(`${this.base}/admin/meet/room`, { url }, this.opts);
  }
  createMeeting(m: Partial<Meeting>): Observable<Meeting> {
    return this.http.post<Meeting>(`${this.base}/admin/meetings`, m, this.opts);
  }
  updateMeeting(id: string, patch: Partial<Meeting>): Observable<Meeting> {
    return this.http.patch<Meeting>(`${this.base}/admin/meetings/${id}`, patch, this.opts);
  }
  deleteMeeting(id: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/meetings/${id}`, this.opts);
  }
  // ── commission ──────────────────────────────────────────────────────────────
  commission(): Observable<CommissionOverview> {
    return this.http.get<CommissionOverview>(`${this.base}/admin/commission`, this.opts);
  }
  /** rates: {fund key: % a year, or null to clear} — returns the recomputed page */
  saveCommissionRates(rates: Record<string, number | null>): Observable<CommissionOverview> {
    return this.http.put<CommissionOverview>(`${this.base}/admin/commission/rates`, { rates }, this.opts);
  }

  /** Holdings vs transactions, per client. */
  consistency(): Observable<Consistency> {
    return this.http.get<Consistency>(`${this.base}/admin/reports/consistency`, this.opts);
  }
  /** Repair: holdings := the roll-up of every transaction, for every client. */
  rebuildHoldings(): Observable<{ clients: number; rows: number; removed: number; consistency: Consistency }> {
    return this.http.post<{ clients: number; rows: number; removed: number; consistency: Consistency }>(`${this.base}/admin/reports/rebuild-holdings`, {}, this.opts);
  }
  reportUploads(): Observable<ReportUpload[]> {
    return this.http.get<ReportUpload[]>(`${this.base}/admin/reports/uploads`, this.opts);
  }
  reportToday(date?: string): Observable<TodayStatus> {
    const q = date ? `?report_date=${date}` : '';
    return this.http.get<TodayStatus>(`${this.base}/admin/reports/today${q}`, this.opts);
  }
  reportClients(): Observable<NetWorthRow[]> {
    return this.http.get<NetWorthRow[]>(`${this.base}/admin/reports/clients`, this.opts);
  }
  reportClientDetail(code: string): Observable<ClientNetWorth> {
    return this.http.get<ClientNetWorth>(`${this.base}/admin/reports/clients/${code}`, this.opts);
  }
  clientTransactions(code: string): Observable<ClientTxn[]> {
    return this.http.get<ClientTxn[]>(`${this.base}/admin/reports/clients/${code}/transactions`, this.opts);
  }
  /** Portfolio-wide mapping health: every transaction not mapped to a villa. */
  mappingOverview(): Observable<MappingOverview> {
    return this.http.get<MappingOverview>(`${this.base}/admin/reports/mapping`, this.opts);
  }
  clientVillas(code: string): Observable<ClientVilla[]> {
    return this.http.get<ClientVilla[]>(`${this.base}/admin/reports/clients/${code}/villas`, this.opts);
  }
  createClientVilla(code: string, name: string): Observable<ClientVilla> {
    return this.http.post<ClientVilla>(`${this.base}/admin/reports/clients/${code}/villas`, { name }, this.opts);
  }
  updateClientVilla(villaId: string, patch: Partial<{ name: string; status: string; coin: boolean; sort_order: number }>): Observable<ClientVilla> {
    return this.http.patch<ClientVilla>(`${this.base}/admin/reports/villas/${villaId}`, patch, this.opts);
  }
  deleteClientVilla(villaId: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/reports/villas/${villaId}`, this.opts);
  }
  assignTxns(villaId: string, orderIds: string[]): Observable<{ assigned: number }> {
    return this.http.post<{ assigned: number }>(`${this.base}/admin/reports/villas/${villaId}/assign`, { order_ids: orderIds }, this.opts);
  }
  /** How ₹amount on `date` splits across the DigiVilla mix (or one fund), at that day's NAV. */
  purchasePreview(date: string, amount: number, schemeCode?: number | null): Observable<{ lines: PurchaseLine[]; mix: { scheme_code: number; scheme_name: string; weight: number }[] }> {
    const params: Record<string, string> = { date, amount: String(amount) };
    if (schemeCode) params['scheme_code'] = String(schemeCode);
    return this.http.get<any>(`${this.base}/admin/reports/purchase/preview`, { ...this.opts, params });
  }
  /** Record a purchase by hand and pin it to a villa (or a new one) in one step. */
  addPurchase(code: string, body: { date: string; amount: number; kind: string; scheme_code?: number | null; villa_id?: string | null; new_villa?: boolean }): Observable<{ villa_id: string; transactions: ClientTxn[] }> {
    return this.http.post<any>(`${this.base}/admin/reports/clients/${code}/purchases`, body, this.opts);
  }
  /** Undo a hand-added transaction line. */
  deleteManualTxn(orderId: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/reports/transactions/${encodeURIComponent(orderId)}`, this.opts);
  }
  unassignTxns(orderIds: string[]): Observable<{ unassigned: number }> {
    return this.http.post<{ unassigned: number }>(`${this.base}/admin/reports/villas/unassign`, { order_ids: orderIds }, this.opts);
  }
  // ── villas vs the market (home chart) ─────────────────────────────────────
  /** Daily index levels + the villa mixes; the chart replays each villa from any start day. */
  // ── villas sold by type ─────────────────────────────────────────────────────
  villasSummary(): Observable<VillaSummary> {
    return this.http.get<VillaSummary>(`${this.base}/admin/villas/summary`, this.opts);
  }
  setVillaType(villaId: string, type: VillaType | null): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.base}/admin/villas/${villaId}/type`, { type }, this.opts);
  }
  // ── markets today (India board: indices, gold, arbitrage, rupee, US 10-yr, S&P 500, villas) ──
  indiaBoard(range: IRange): Observable<IndiaBoard> {
    return this.http.get<IndiaBoard>(`${this.base}/admin/india/board`, { ...this.opts, params: { range } });
  }
  // ── global markets (MSCI world, 47 countries, commodities, currencies) ─────────
  globalSnapshot(): Observable<GlobalSnapshot> {
    return this.http.get<GlobalSnapshot>(`${this.base}/admin/global/snapshot`, this.opts);
  }
  globalHistory(key: string): Observable<GlobalHistory> {
    return this.http.get<GlobalHistory>(`${this.base}/admin/global/history`, { ...this.opts, params: { key } });
  }
  // ── world markets ───────────────────────────────────────────────────────────
  worldQuotes(): Observable<WorldQuotes> {
    return this.http.get<WorldQuotes>(`${this.base}/admin/world/quotes`, this.opts);
  }
  worldChart(key: string, range: string, ccy: 'usd' | 'local' = 'usd'): Observable<WorldChart> {
    return this.http.get<WorldChart>(`${this.base}/admin/world/chart`, { ...this.opts, params: { key, range, ccy } });
  }
  /** daily closes since 2000 (own currency + US dollars); every longer time frame is cut from it */
  worldHistory(key: string): Observable<WorldHistory> {
    return this.http.get<WorldHistory>(`${this.base}/admin/world/history`, { ...this.opts, params: { key } });
  }

  worldInflation(): Observable<WorldCpi> {
    return this.http.get<WorldCpi>(`${this.base}/admin/world/inflation`, this.opts);
  }

  marketPerformance(): Observable<MarketData> {
    return this.http.get<MarketData>(`${this.base}/admin/market/performance`, this.opts);
  }
  marketLive(): Observable<MarketLive> {
    return this.http.get<MarketLive>(`${this.base}/admin/market/live`, this.opts);
  }
  // ── check the maths ──────────────────────────────────────────────────────
  auditClient(code: string): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/audit/client/${encodeURIComponent(code)}`, this.opts);
  }
  /** What the calculators are fed: index series, weights, every month-end value, the rules. */
  auditData(): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/audit/data`, this.opts);
  }
  auditNavs(): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/audit/navs`, this.opts);
  }
  /** The exact month-end NAVs the client app's calculators use. */
  // ── calculator settings (one source of truth for every calculator number) ──
  calcConfig(): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/calc-config`, this.opts);
  }
  calcConfigValidate(cfg: any): Observable<{ errors: string[] }> {
    return this.http.post<{ errors: string[] }>(`${this.base}/admin/calc-config/validate`, cfg, this.opts);
  }
  calcConfigSave(cfg: any): Observable<any> {
    return this.http.put<any>(`${this.base}/admin/calc-config`, cfg, this.opts);
  }
  calcConfigVersion(v: number): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/calc-config/version/${v}`, this.opts);
  }

  auditVillaFunds(): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/audit/villa-funds`, this.opts);
  }
  /** A calculator recomputed independently (Python), with its ledger. */
  auditCalc(params: Record<string, string | number>): Observable<any> {
    const p: Record<string, string> = {};
    for (const k of Object.keys(params)) p[k] = String(params[k]);
    return this.http.get<any>(`${this.base}/admin/audit/calc`, { ...this.opts, params: p });
  }
  villasLive(): Observable<VillaLive[]> {
    return this.http.get<VillaLive[]>(`${this.base}/admin/reports/villas`, this.opts);
  }
  reportBuckets(): Observable<VillaBucket[]> {
    return this.http.get<VillaBucket[]>(`${this.base}/admin/reports/buckets`, this.opts);
  }
  createBucket(body: { name: string; tier?: string; kind?: string; subtitle?: string; funds: BucketFund[] }): Observable<VillaBucket> {
    return this.http.post<VillaBucket>(`${this.base}/admin/reports/buckets`, body, this.opts);
  }
  deleteBucket(id: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/reports/buckets/${id}`, this.opts);
  }
  reportCalendar(start: string, end: string): Observable<CalDay[]> {
    return this.http.get<CalDay[]>(`${this.base}/admin/reports/calendar?start=${start}&end=${end}`, this.opts);
  }
}

// ── report types ────────────────────────────────────────────────────────────
export interface ReportUpload {
  id?: string; report_date: string; report_type: 'user' | 'transaction';
  filename: string; storage_path?: string; size_bytes?: number;
  row_count?: number; status?: string; uploaded_at?: string;
  /** transaction uploads only (returned by the upload call, not stored): lines
   *  new by order id · lines already known (refreshed in place) · hand-added
   *  purchases the report confirmed · the holdings rebuild that followed */
  added?: number; updated?: number; absorbed?: number; clients?: string[];
  holdings?: { clients: number; rows: number; removed: number; no_transactions: string[] };
}
/** The system's own tie-out: every client's holdings vs their transactions. */
export interface ConsistencyRow {
  client_code: string; name: string; ok: boolean; transactions: number; holdings: number; diff: number; txn_count: number;
}
export interface Consistency { as_of: string; ok: boolean; clients: ConsistencyRow[]; off: ConsistencyRow[]; }
export interface TodayStatus {
  report_date: string; user: ReportUpload | null; transaction: ReportUpload | null;
}
export interface NetWorthRow {
  client_code: string; name: string; city?: string; phone?: string;
  net_worth: number; invested: number; gain: number; gain_pct: number; holdings_count: number;
  /** the public demo account — shown, but kept out of the totals */
  demo?: boolean;
}
export interface Holding {
  scheme_name: string; scheme_code?: number; folio_no?: string;
  units: number; invested: number; nav?: number; nav_date?: string;
  current_value: number; gain: number;
}
export interface VillaMatch {
  bucket_id: string; name: string; tier?: string; owned_count: number;
  total_funds: number; complete: boolean; value: number; invested: number;
  gain: number; funds: Holding[];
}
export interface ClientNetWorth {
  client: any; net_worth: number; invested: number; gain: number; gain_pct: number;
  villas: VillaMatch[]; villa_count: number; extra: Holding[]; holdings: Holding[];
}
export interface ClientTxn {
  order_id: string; client_code: string; txn_date: string;
  scheme_name: string; scheme_code?: number; folio_no?: string;
  kind: string; amount: number; nav: number; units: number;
  villa_id: string | null; report_date: string;
  /** where this line's money sits by the shared villa rule (a split line lists
   *  several villas); [] when the fund is outside every DigiVilla bucket */
  placements?: { villa_id: string; position: number; amount: number; units: number; fraction: number }[];
  /** fund in no DigiVilla bucket and not pinned → needs the admin */
  outside?: boolean;
}
/** One unmapped transaction, as listed in the home-screen alert. */
export interface UnmappedTxn {
  order_id: string; txn_date: string | null; scheme_name: string; kind: string | null; amount: number;
}
/** One client that still has transactions with no villa. */
export interface UnmappedClient {
  client_code: string; name: string; villa_count: number;
  total: number; mapped: number; unmapped: number; unmapped_amount: number;
  txns: UnmappedTxn[];
}
export interface MappingOverview {
  as_of: string;
  /** holdings == transactions for every client? (`off` lists who isn't) */
  consistency?: { ok: boolean; off: ConsistencyRow[] };
  total: number; mapped: number; unmapped: number; unmapped_amount: number;
  clients_affected: number;
  clients: UnmappedClient[];
  by_client: Record<string, { total: number; mapped: number; unmapped: number }>;
}
export interface ClientVilla {
  id: string; client_code: string; name: string;
  status: 'building' | 'constructed'; coin: boolean; sort_order: number;
  mapped_total: number; txn_count: number;
  hint: { unit: number; progress: number; suggest_constructed: boolean };
  /** what the client's app shows: its pinned transactions at today's NAV */
  value: number; gain: number;
  /** first purchase date pinned to it (ISO) */
  since: string;
  /** ≥ ₹5L pinned (or marked constructed) */
  finished: boolean;
  /** its place on the client's estate (0 = Villa 1); null when nothing is pinned */
  position: number | null;
  /** admin-set villa type (null = not set yet) */
  villa_type?: VillaType | null;
  /** made by the shared rule (no admin row yet) — create a villa to name it / set its type */
  auto?: boolean;
  /** lines the admin pinned here by hand (the rest were placed by the rule) */
  pinned_count?: number;
  /** the funds inside it, by the rule */
  funds?: { scheme_code: number; scheme_name: string; units: number; invested: number }[];
}
/** One fund line of a purchase being added by hand. */
export interface PurchaseLine {
  scheme_code: number; scheme_name: string; weight: number;
  amount: number; nav: number | null; nav_date: string | null; units: number | null;
}
export interface BucketFund {
  scheme_name: string; scheme_code?: number; target_weight?: number;
  category?: string;
  /** Concentration sleeve for the client home allocation bar:
   *  'arbitrage' | 'gold' | 'large' | 'mid' | 'small' | 'other'. */
  sleeve?: string;
  ret_1y?: number | null; ret_3y?: number | null; ret_5y?: number | null;
}
export interface CalDay {
  date: string; status: 'both' | 'partial' | 'none'; user: any | null; transaction: any | null;
}
export interface VillaBucket { id: string; name: string; tier?: string; kind?: string; subtitle?: string; funds: BucketFund[]; }
export interface VillaLive {
  bucket_id: string; name: string; tier?: string; nav_sum: number;
  funds: { scheme_name: string; scheme_code?: number; nav?: number; nav_date?: string; target_weight?: number }[];
}

/** /admin/market/live — today's index moves from NSE (price indices; cached 60 s server-side). */
export interface MarketLive {
  open: boolean;
  status: string;
  day: string | null;      // trade date of the board, yyyy-mm-dd
  time: string | null;     // HH:MM IST
  quotes: Record<string, { last: number; prev: number; pct: number; adv: number | null; dec: number | null; high: number; low: number }>;
  stale?: boolean;
}

// ── global markets ───────────────────────────────────────────────────────────
export type GPeriod = '1d' | '1w' | '1m' | '3m' | 'ytd' | '1y' | '3y' | '5y';
export type GMoves = Record<GPeriod, number | null>;
/** one instrument's quote: moves in its own currency, in US$ and in ₹ */
export interface GQuote {
  key: string; ok: boolean; last?: number | null; prev?: number | null; session?: string | null; time?: number | null;
  high?: number | null; low?: number | null; hi52?: number | null; lo52?: number | null;
  local?: GMoves; usd?: GMoves; inr?: GMoves | null; spark?: number[]; bp?: number;
}
export interface GMsci extends GQuote { name: string; about: string; etf: string; symbol: string; src: Partial<Record<GPeriod, 'index' | 'etf' | null>>; q_etf: GQuote; }
export interface GCountry {
  iso: string; name: string; flag: string; cls: 'DM' | 'EM'; region: string; ccy: string;
  index: string | null; index_name: string | null; etf: string | null;
  q_index: GQuote | null; q_etf: GQuote | null; fx: GMoves;
  perf: { local: GMoves; usd: GMoves; inr: GMoves; src: Record<GPeriod, 'index' | 'etf' | null> };
}
export interface GCommodity extends GQuote { name: string; group: string; unit: string; symbol: string; }
export interface GCurrency {
  ccy: string; name: string; flag: string; pegged: boolean; suspect?: boolean; per_usd: number; per_inr: number | null; inr_per: number | null;
  vs_usd: GMoves; vs_inr: GMoves; session: string; spark: number[];
}
export interface GGauge extends GQuote { name: string; about: string; kind: 'level' | 'yield'; symbol: string; }
export interface GInstrument { key: string; type: string; name: string; ccy: string; country?: string; group?: string; unit?: string; }
export interface GlobalSnapshot {
  as_of: number | null; periods: GPeriod[]; msci: GMsci[]; countries: GCountry[]; commodities: GCommodity[];
  currencies: GCurrency[]; gauges: GGauge[]; instruments: GInstrument[];
}
/** d = day numbers since 1970; v = own currency, u = US$, r = ₹ (a currency: its value, US$ / ₹ per unit) */
export interface GlobalHistory { key: string; name: string; type: string; currency: string; d: number[]; v: number[]; u: (number | null)[]; r: (number | null)[] | null; }

// ── markets today (India board) ───────────────────────────────────────────────
export type IRange = '1d' | '1w' | '1m' | '3m' | 'ytd' | '1y';
export type IKind = 'index' | 'gold' | 'arbitrage' | 'fx' | 'yield' | 'us';
export interface IItem {
  key: string; name: string; short: string; group: string; kind: IKind; about: string; ok: boolean;
  last: number | null; prev: number | null; base: number | null; session: string | null; time: number | null;
  high?: number | null; low?: number | null; adv?: number | null; dec?: number | null;
  /** move over the range (% — or percentage points for a yield) and today's move */
  pct: number | null; day_pct: number | null; unit?: 'pp';
  source: 'live' | 'close';
  /** the series over the range: unix seconds, % from the range's base */
  t: number[]; v: number[];
}
export interface IBasket { ok: boolean; pct: number | null; day_pct: number | null; t: number[]; v: number[]; }
export interface IVilla {
  key: string; name: string; risk: number; risk_name: string;
  weights: Record<string, number>; weights_no_gold: Record<string, number>;
  with_gold: IBasket; no_gold: IBasket;
}
export interface IndiaBoard {
  as_of: number | null; range: IRange; ranges: IRange[];
  nse: { open?: boolean; status?: string; day?: string | null; time?: string | null };
  session: string | null; items: IItem[]; villas: IVilla[]; default_villa: string | null; parts: Record<string, string>;
}
