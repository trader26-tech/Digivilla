import { Injectable, computed, signal } from '@angular/core';

/** A scheduled call with the fund manager. */
export interface ManagerCall {
  id: string;
  /** ISO datetime of the call. */
  at: string;
  /** What it's about, e.g. "Review my portfolio" or "Withdraw from Green Villa". */
  topic: string;
}

const CALLS_KEY = 'manager_calls_v1';

/**
 * The user's scheduled calls with their fund manager. Persisted to
 * localStorage, exposed as signals so any screen (the home button, a detail
 * page's withdraw flow) can add to and read the same list.
 */
@Injectable({ providedIn: 'root' })
export class CallsService {
  readonly calls = signal<ManagerCall[]>(this.load());

  /** Upcoming calls only (at or after now), soonest first. */
  readonly upcoming = computed(() => {
    const now = Date.now();
    return this.calls()
      .filter((c) => new Date(c.at).getTime() >= now)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  });

  /** The soonest upcoming call, or null. */
  readonly next = computed(() => this.upcoming()[0] ?? null);

  /** True when a call falls within the next 24 hours — drives the alert star. */
  readonly hasImminent = computed(() => {
    const n = this.next();
    if (!n) return false;
    const ms = new Date(n.at).getTime() - Date.now();
    return ms >= 0 && ms <= 24 * 60 * 60 * 1000;
  });

  book(at: Date, topic: string): void {
    const call: ManagerCall = {
      id: 'c' + at.getTime() + Math.floor(at.getTime() % 1000),
      at: at.toISOString(),
      topic,
    };
    this.calls.update((cs) => [...cs, call]);
    this.persist();
  }

  cancel(id: string): void {
    this.calls.update((cs) => cs.filter((c) => c.id !== id));
    this.persist();
  }

  // ---------------- persistence ----------------
  private load(): ManagerCall[] {
    try {
      const raw = localStorage.getItem(CALLS_KEY);
      return raw ? (JSON.parse(raw) as ManagerCall[]) : [];
    } catch {
      return [];
    }
  }
  private persist(): void {
    try {
      localStorage.setItem(CALLS_KEY, JSON.stringify(this.calls()));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
}
