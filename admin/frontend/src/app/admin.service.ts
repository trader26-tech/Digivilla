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
  created_at: string;
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
  sip_monthly: number;
  sip_next_payment: string | null;
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

const AT = 'ml_admin_at';       // access token
const AT_EXP = 'ml_admin_at_exp';

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
  private get authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }
  private get opts() {
    return { headers: this.authHeaders, withCredentials: true };
  }

  // ── auth flow ─────────────────────────────────────────────────────────────
  session(): Observable<SessionInfo> {
    return this.http.get<SessionInfo>(`${this.base}/admin/auth/session`, { withCredentials: true });
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
      `${this.base}/admin/auth/unlock`, { pin }, { withCredentials: true });
  }
  refresh(): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(`${this.base}/admin/auth/refresh`, {}, this.opts);
  }
  logoutDevice(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/admin/auth/logout`, {}, this.opts);
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
}
