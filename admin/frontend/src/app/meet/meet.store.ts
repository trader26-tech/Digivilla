import { Injectable, computed, inject, signal } from '@angular/core';

import { AdminService, ClientCall, MeetOverview, Meeting } from '../admin.service';

/** One row of the agenda — a meeting the admin scheduled, or a call a client booked in the app. */
export interface AgendaItem {
  key: string;
  source: 'mine' | 'client';
  title: string;
  who: string;
  phone: string;
  start: Date;
  end: Date;
  minutes: number;
  note: string;
  status: string;               // scheduled | done | cancelled | requested | confirmed
  meeting?: Meeting;            // only for the admin's own meetings
}

const FALLBACK_ROOM = 'https://meet.google.com/eua-iwxb-eez';
const ROOM_CACHE = 'dv_admin_meet_room';

/** Shared by the header's "Meet" button and the home card, so both use the same room link. */
@Injectable({ providedIn: 'root' })
export class MeetStore {
  private api = inject(AdminService);

  readonly data = signal<MeetOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  /** ticks every 30 s so "in 12 min" / "Live now" stay current */
  readonly now = signal(Date.now());

  constructor() { setInterval(() => this.now.set(Date.now()), 30_000); }

  /** the room link — last known one is cached so the header button works before the first load */
  readonly roomUrl = computed(() => this.data()?.room.url || this.cachedRoom || FALLBACK_ROOM);
  private cachedRoom = (() => { try { return localStorage.getItem(ROOM_CACHE) || ''; } catch { return ''; } })();

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.meet().subscribe({
      next: (d) => { this.set(d); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.detail || 'Could not load meetings.'); this.loading.set(false); },
    });
  }

  set(d: MeetOverview): void {
    this.data.set(d);
    try { localStorage.setItem(ROOM_CACHE, d.room.url); } catch { /* private mode */ }
  }

  patch(fn: (d: MeetOverview) => MeetOverview): void {
    const d = this.data();
    if (d) this.set(fn(d));
  }

  readonly agenda = computed<AgendaItem[]>(() => {
    const d = this.data();
    if (!d) return [];
    const mine = d.meetings.map((m): AgendaItem => {
      const start = new Date(m.starts_at);
      return {
        key: 'm:' + m.id, source: 'mine', title: m.title || 'Meeting', who: m.with_name || '',
        phone: m.with_phone || '', start, end: new Date(start.getTime() + m.duration_min * 60_000),
        minutes: m.duration_min, note: m.note || '', status: m.status, meeting: m,
      };
    });
    const booked = d.client_calls.map((c: ClientCall): AgendaItem => {
      const start = new Date(c.starts_at);
      return {
        key: 'c:' + c.id, source: 'client', title: 'Consultation call', who: c.name, phone: c.phone,
        start, end: new Date(start.getTime() + 30 * 60_000), minutes: 30, note: c.note || '', status: c.status,
      };
    });
    return [...mine, ...booked]
      .filter((a) => !isNaN(a.start.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  /** still to happen (or happening now), not done/cancelled */
  readonly upcoming = computed(() => {
    const now = this.now();
    return this.agenda().filter((a) => a.end.getTime() > now && a.status !== 'done' && a.status !== 'cancelled');
  });

  /** the record — everything already over, newest first */
  readonly history = computed(() => {
    const now = this.now();
    return this.agenda()
      .filter((a) => a.end.getTime() <= now || a.status === 'done' || a.status === 'cancelled')
      .reverse();
  });

  /** the meeting to surface on the room card: live now, or the next one */
  readonly next = computed(() => this.upcoming()[0] || null);
  readonly liveOrSoon = computed(() => {
    const n = this.next();
    return !!n && n.start.getTime() - this.now() <= 10 * 60_000;
  });
}
