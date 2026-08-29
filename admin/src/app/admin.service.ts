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

const TOKEN_KEY = 'ml_admin_token';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  get token(): string {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  get isLoggedIn(): boolean {
    return !!this.token;
  }
  private get authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  login(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.base}/admin/login`, { username, password });
  }
  saveToken(t: string): void {
    localStorage.setItem(TOKEN_KEY, t);
  }
  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  listBookings(): Observable<Booking[]> {
    return this.http.get<Booking[]>(`${this.base}/admin/bookings`, { headers: this.authHeaders });
  }
  setStatus(id: string, status: 'confirmed' | 'declined' | 'requested'): Observable<Booking> {
    return this.http.post<Booking>(
      `${this.base}/admin/bookings/${id}/status`,
      { status },
      { headers: this.authHeaders },
    );
  }
  deleteBooking(id: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.base}/admin/bookings/${id}`, {
      headers: this.authHeaders,
    });
  }
}
