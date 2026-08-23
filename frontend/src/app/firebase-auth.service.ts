import { Injectable } from '@angular/core';

/**
 * Firebase phone-number (OTP) authentication.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW TO WIRE YOUR FIREBASE PROJECT (one-time setup)
 * ─────────────────────────────────────────────────────────────────────────
 *  1. Install the SDK:      npm i firebase
 *  2. Firebase console → Authentication → Sign-in method → enable "Phone".
 *     (For local/dev, add your test numbers under "Phone numbers for testing"
 *      so you don't burn real SMS.)
 *  3. Firebase console → Project settings → your Web app → copy the config
 *     object and paste it into `firebaseConfig` below (or, better, move it to
 *     src/environments/environment.ts and import it here).
 *  4. Authorised domains: add your Railway domain (…up.railway.app) and
 *     localhost under Authentication → Settings → Authorised domains, or the
 *     reCAPTCHA will refuse to run.
 *  5. Flip `ENABLED` to true. Until then this service runs in MOCK mode:
 *     it "sends" a code and accepts any 6 digits, so the UI flow works with
 *     no backend.
 *
 *  The component calls:
 *     await auth.sendCode('+919876543210', recaptchaHostEl)   // step 1
 *     const user = await auth.verifyCode('123456')            // step 2
 *  and gets back { uid, phone, idToken } which you can send to your FastAPI
 *  backend (verify the idToken there with the Firebase Admin SDK) to mint
 *  your own session — replacing the `wp_token` placeholder in app.component.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Flip to true once firebaseConfig below is filled in and `firebase` is installed. */
const ENABLED = true;

/** Firebase web config (Project settings → Web app). The apiKey here is a
 *  public client identifier, not a secret — safe to ship in the bundle. */
const firebaseConfig = {
  apiKey: 'AIzaSyBtUWNbC4OB8sjJ3VXYyRb8AMzCPayzE48',
  authDomain: 'mylakshayas.firebaseapp.com',
  projectId: 'mylakshayas',
  storageBucket: 'mylakshayas.firebasestorage.app',
  messagingSenderId: '572488679925',
  appId: '1:572488679925:web:945d9047aa80946b0a60bc',
  measurementId: 'G-41V00XP3GC',
};

export interface PhoneUser {
  uid: string;
  phone: string;
  idToken: string;
}

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  private confirmation: any = null;   // ConfirmationResult from signInWithPhoneNumber
  private recaptcha: any = null;
  private auth: any = null;

  /** True in mock mode (Firebase not yet configured) — the UI can show a hint. */
  get isMock(): boolean {
    return !ENABLED || !firebaseConfig.apiKey;
  }

  /**
   * Step 1 — send the OTP to `e164Phone` (e.g. "+919876543210").
   * `hostEl` is an element used to mount the invisible reCAPTCHA verifier.
   */
  async sendCode(e164Phone: string, hostEl: HTMLElement): Promise<void> {
    if (this.isMock) {
      // Mock: pretend an SMS went out; verifyCode() will accept any 6 digits.
      this.confirmation = 'MOCK';
      return;
    }

    // Lazy-load the SDK so the mock path pulls in nothing. The specifiers are
    // built at runtime so TypeScript doesn't require `firebase` to be installed
    // until you actually flip ENABLED on (then run `npm i firebase`).
    const appMod = 'firebase/app';
    const authMod = 'firebase/auth';
    const { initializeApp, getApps } = await import(/* @vite-ignore */ appMod);
    const { getAuth, RecaptchaVerifier, signInWithPhoneNumber } = await import(/* @vite-ignore */ authMod);

    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    this.auth = getAuth(app);

    // A fresh invisible reCAPTCHA per attempt keeps things simple.
    this.recaptcha?.clear?.();
    this.recaptcha = new RecaptchaVerifier(this.auth, hostEl, { size: 'invisible' });

    this.confirmation = await signInWithPhoneNumber(this.auth, e164Phone, this.recaptcha);
  }

  /**
   * Step 2 — verify the 6-digit `code`. Resolves to the signed-in user
   * (with an ID token you can hand to your backend), or throws on a bad code.
   */
  async verifyCode(code: string): Promise<PhoneUser> {
    if (!this.confirmation) throw new Error('Call sendCode() first.');

    if (this.confirmation === 'MOCK') {
      if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
      return { uid: 'mock_' + Date.now(), phone: 'mock', idToken: 'mock' };
    }

    const cred = await this.confirmation.confirm(code);
    const idToken = await cred.user.getIdToken();
    return { uid: cred.user.uid, phone: cred.user.phoneNumber ?? '', idToken };
  }

  reset(): void {
    this.confirmation = null;
    this.recaptcha?.clear?.();
    this.recaptcha = null;
  }
}
