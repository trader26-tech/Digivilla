import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

export interface BookingCreate {
  name: string;
  phone: string;
  property: string;
  variant: string;
  plots: number;
  amount: number;
  slot: string; // ISO-8601
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
  private base = environment.apiUrl;

  createBooking(payload: BookingCreate): Observable<Booking> {
    return this.http.post<Booking>(`${this.base}/bookings`, payload);
  }

  /** ISO slots already confirmed — greyed out in the picker. */
  takenSlots(): Observable<{ slots: string[] }> {
    return this.http.get<{ slots: string[] }>(`${this.base}/bookings/taken`);
  }
}
