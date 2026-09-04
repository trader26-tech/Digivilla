import { Injectable, signal } from '@angular/core';

import { environment } from '../../environments/environment';

/** Shape of the Firebase web config we read from env.js at runtime. */
interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
}

/** The signed-in user, as returned by our backend. */
export interface AuthUser {
  owner: string;
  name?: string;
  phone?: string;
  email?: string;
  age?: number | null;
  city?: string;
  /** True once name + email + age + city are all filled in. */
  profile_complete?: boolean;
}

const TOKEN_KEY = 'auth_token_v1';
const USER_KEY = 'auth_user_v1';

/**
 * Phone-OTP authentication.
 *
 * Flow:
 *   1. sendCode(phone)  — Firebase sends an SMS (invisible reCAPTCHA), or, when
 *      no Firebase web config is present, we fall back to a dev code so the UI
 *      is fully testable. Returns nothing; the confirmation handle is kept.
 *   2. verifyCode(code) — confirms the SMS code with Firebase to get an ID
 *      token, then posts it to the backend's /auth/phone, which verifies it
 *      with the Firebase Admin SDK and returns our session token + user.
 *
 * The session token + user are persisted so a returning, already-verified user
 * skips the login screen.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** The current session token, or null when signed out. */
  readonly token = signal<string | null>(this.loadToken());
  /** The current user, or null. */
  readonly user = signal<AuthUser | null>(this.loadUser());
  /** True once a verified session exists. */
  readonly signedIn = signal<boolean>(!!this.loadToken());
  /** True once the signed-in user has completed their profile details. */
  readonly profileComplete = signal<boolean>(this.loadUser()?.profile_complete ?? false);

  /** Kept between sendCode and verifyCode. */
  private confirmation: import('firebase/auth').ConfirmationResult | null = null;
  private pendingPhone = '';
  /** Dev fallback: the code we "sent" when Firebase isn't configured. */
  private devCode: string | null = null;

  private get fbConfig(): FirebaseWebConfig | null {
    const w = (typeof window !== 'undefined' ? (window as any).__env : undefined) || {};
    const c = w.firebase as Partial<FirebaseWebConfig> | undefined;
    if (c && c.apiKey && c.authDomain && c.projectId && c.appId) return c as FirebaseWebConfig;
    return null;
  }

  /** True when real Firebase SMS is available. */
  get firebaseReady(): boolean {
    return !!this.fbConfig;
  }

  // ---------------- step 1: send the code ----------------

  async sendCode(phone: string): Promise<void> {
    this.pendingPhone = this.e164(phone);
    this.confirmation = null;
    this.devCode = null;

    const cfg = this.fbConfig;
    if (!cfg) {
      // Dev fallback — a fixed, obvious code so the flow is testable without
      // Firebase. The backend's allow_unverified_phone accepts it.
      this.devCode = '123456';
      return;
    }

    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth, RecaptchaVerifier, signInWithPhoneNumber } = await import('firebase/auth');
    const app = getApps().length ? getApps()[0] : initializeApp(cfg);
    const auth = getAuth(app);

    // one invisible reCAPTCHA, mounted on a container the login screen provides
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    this.confirmation = await signInWithPhoneNumber(auth, this.pendingPhone, verifier);
  }

  // ---------------- step 2: verify + exchange for our session ----------------

  async verifyCode(code: string): Promise<AuthUser> {
    let idToken = '';

    if (this.confirmation) {
      const cred = await this.confirmation.confirm(code.trim());
      idToken = await cred.user.getIdToken();
    } else {
      // dev fallback
      if (code.trim() !== this.devCode) {
        throw new Error('That code is not correct.');
      }
    }

    // exchange with our backend for a session token + user record
    const res = await fetch(`${environment.apiUrl}/auth/phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: this.pendingPhone, id_token: idToken }),
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      throw new Error(msg?.detail || 'Sign-in failed. Please try again.');
    }
    const data = (await res.json()) as { token: string; user: AuthUser };
    this.persist(data.token, data.user);
    return data.user;
  }

  // ---------------- step 3: complete profile (new users) ----------------

  /** Save name + email + age + city for a signed-in user. Updates the stored
   *  user + flips profileComplete when the backend confirms it's complete. */
  async saveProfile(details: { name: string; email: string; age: number | null; city: string }): Promise<AuthUser> {
    const token = this.token();
    if (!token) throw new Error('Your session has expired. Please sign in again.');
    const res = await fetch(`${environment.apiUrl}/auth/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(details),
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      throw new Error(msg?.detail || 'Could not save your details. Please try again.');
    }
    const user = (await res.json()) as AuthUser;
    this.persist(token, user);
    return user;
  }

  signOut(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    this.token.set(null);
    this.user.set(null);
    this.signedIn.set(false);
    this.profileComplete.set(false);
  }

  // ---------------- helpers ----------------

  private persist(token: string, user: AuthUser): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {}
    this.token.set(token);
    this.user.set(user);
    this.signedIn.set(true);
    this.profileComplete.set(!!user.profile_complete);
  }

  private e164(phone: string): string {
    const p = phone.trim().replace(/\s+/g, '');
    const digits = p.replace(/\D/g, '');
    if (!p.startsWith('+') && digits.length === 10) return '+91' + digits;
    return p.startsWith('+') ? p : '+' + digits;
  }

  private loadToken(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  private loadUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch { return null; }
  }
}
