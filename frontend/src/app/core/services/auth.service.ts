import { Injectable, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';

import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Current auth session, exposed as a signal for templates/guards. */
  readonly session = signal<Session | null>(null);
  readonly user = signal<User | null>(null);

  constructor(private readonly supabase: SupabaseService) {
    // Hydrate the current session on startup.
    void this.supabase.client.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.user.set(data.session?.user ?? null);
    });

    // Keep signals in sync with auth state changes.
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.user.set(session?.user ?? null);
    });
  }

  get accessToken(): string | null {
    return this.session()?.access_token ?? null;
  }

  signInWithPassword(email: string, password: string) {
    return this.supabase.client.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string) {
    return this.supabase.client.auth.signUp({ email, password });
  }

  signOut() {
    return this.supabase.client.auth.signOut();
  }
}
