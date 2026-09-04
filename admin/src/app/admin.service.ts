import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

export interface Booking {
  id: string;
  name: string;
  phone: string;
  property: string;
  variant: string;
  plots: number;
  amount: number;
  slot: string; // ISO-8601
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
}
export interface DaySlot {
  time: string; // "HH:MM"
  slot: string; // ISO-8601
  blocked: boolean;
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
