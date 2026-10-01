import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, of } from 'rxjs';

import { AuthService } from './auth/auth.service';

import { environment } from '../environments/environment';

/** What the client is asking the advisor to do. */
export type RequestKind = 'consultation' | 'sip' | 'buy' | 'withdraw';

export interface BookingCreate {
  name: string;
  phone: string;
  kind?: RequestKind;
  property: string;
  variant: string;
  plots?: number;
  amount?: number;
  slot?: string; // ISO-8601 (consultation only)
  note?: string;
}

export interface Booking extends BookingCreate {
  id: string;
  status: string;
  meet_link?: string;   // Google Meet / video link for the call
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private http = inject(HttpClient);
  // Bookings are served by the admin backend (shared bookings DB), not the
  // planner/funds API, so use bookingApiUrl.
  private base = environment.bookingApiUrl;
  private auth = inject(AuthService);

  /** The demo walks through every flow, but never reaches the advisor: the
   *  request "succeeds" locally and nothing is sent. */
  private demoBooking(payload: Partial<BookingCreate>): Observable<Booking> {
    return of({
      id: 'demo', status: 'confirmed', created_at: new Date().toISOString(),
      name: payload.name || 'Demo', phone: payload.phone || '', property: payload.property || 'villa',
      variant: payload.variant || 'balanced', ...payload,
    } as Booking).pipe(delay(400));
  }

  createBooking(payload: BookingCreate): Observable<Booking> {
    if (this.auth.isDemo()) return this.demoBooking(payload);
    return this.http.post<Booking>(`${this.base}/bookings`, payload);
  }

  /** Fire a slot-less action request (SIP / buy / withdraw) to the advisor. */
  createRequest(payload: {
    name: string; phone: string; kind: RequestKind;
    property: string; variant?: string; amount?: number; note?: string;
  }): Observable<Booking> {
    if (this.auth.isDemo()) return this.demoBooking(payload);
    return this.http.post<Booking>(`${this.base}/bookings`, { plots: 1, ...payload });
  }

  /** ISO slots already confirmed — greyed out in the picker. */
  takenSlots(): Observable<{ slots: string[] }> {
    return this.http.get<{ slots: string[] }>(`${this.base}/bookings/taken`);
  }

  /** This client's own bookings (by phone), newest first — used to show the
   *  setup call they booked on the home screen. */
  mine(phone: string): Observable<Booking[]> {
    if (this.auth.isDemo()) return of([]);
    return this.http.get<Booking[]>(`${this.base}/bookings/mine?phone=${encodeURIComponent(phone)}`);
  }

  /** The advisor's FREE 30-min slots on a date (YYYY-MM-DD) — only times the
   *  advisor is actually open. Used by the book-now sheet. */
  freeSlots(date: string): Observable<{ date: string; slots: { time: string; slot: string }[] }> {
    return this.http.get<{ date: string; slots: { time: string; slot: string }[] }>(
      `${this.base}/availability/free?date=${date}`);
  }

  /** The next few days that have free slots, in ONE request (fast). */
  freeDays(limit = 4): Observable<{ days: { date: string; slots: { time: string; slot: string }[] }[] }> {
    return this.http.get<{ days: { date: string; slots: { time: string; slot: string }[] }[] }>(
      `${this.base}/availability/free-days?limit=${limit}`);
  }
}
