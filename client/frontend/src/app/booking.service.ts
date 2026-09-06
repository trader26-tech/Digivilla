import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

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
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private http = inject(HttpClient);
  // Bookings are served by the admin backend (shared bookings DB), not the
  // planner/funds API, so use bookingApiUrl.
  private base = environment.bookingApiUrl;

  createBooking(payload: BookingCreate): Observable<Booking> {
    return this.http.post<Booking>(`${this.base}/bookings`, payload);
  }

  /** Fire a slot-less action request (SIP / buy / withdraw) to the advisor. */
  createRequest(payload: {
    name: string; phone: string; kind: RequestKind;
    property: string; variant?: string; amount?: number; note?: string;
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.base}/bookings`, { plots: 1, ...payload });
  }

  /** ISO slots already confirmed — greyed out in the picker. */
  takenSlots(): Observable<{ slots: string[] }> {
    return this.http.get<{ slots: string[] }>(`${this.base}/bookings/taken`);
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
