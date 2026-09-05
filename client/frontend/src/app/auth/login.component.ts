import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from './auth.service';

/**
 * Phone-OTP login screen. Step 1 collects a name + phone and sends the code;
 * step 2 verifies the SMS code and, on success, emits `done` so the shell
 * reveals the app. Nothing past this gate renders until the phone is verified.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  @Output() done = new EventEmitter<void>();

  private readonly auth = inject(AuthService);

  step = signal<'welcome' | 'phone' | 'otp' | 'details'>('welcome');
  phone = signal('');
  code = signal('');
  busy = signal(false);
  error = signal('');

  // profile-details step
  name = signal('');
  email = signal('');
  age = signal('');
  city = signal('');

  constructor() {
    // A returning user who verified their phone before but never finished their
    // details: skip phone/OTP and drop them straight on the details step.
    if (this.auth.signedIn() && !this.auth.profileComplete()) {
      const u = this.auth.user();
      this.name.set(u?.name || '');
      this.email.set((u?.email && !u.email.endsWith('@mylakshyas.local') && u.email) || '');
      this.city.set(u?.city || '');
      this.age.set(u?.age != null ? String(u.age) : '');
      this.step.set('details');
    }
  }

  get firebaseReady(): boolean { return this.auth.firebaseReady; }

  /** Leave the welcome screen and begin the sign-in flow. */
  start(): void {
    this.error.set('');
    this.step.set('phone');
  }

  get phoneValid(): boolean {
    return this.phone().replace(/\D/g, '').length >= 10;
  }
  get codeValid(): boolean {
    return this.code().replace(/\D/g, '').length === 6;
  }
  get detailsValid(): boolean {
    const emailOk = /^\S+@\S+\.\S+$/.test(this.email().trim());
    const ageN = parseInt(this.age(), 10);
    const ageOk = !this.age().trim() || (ageN >= 1 && ageN <= 120);
    return this.name().trim().length > 0 && emailOk && !!this.city().trim() && ageOk && !!this.age().trim();
  }

  async sendCode(): Promise<void> {
    if (!this.phoneValid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.sendCode(this.phone());
      this.step.set('otp');
    } catch (e: any) {
      this.error.set(this.friendly(e));
    } finally {
      this.busy.set(false);
    }
  }

  async verify(): Promise<void> {
    if (!this.codeValid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const user = await this.auth.verifyCode(this.code());
      // Returning user with a full profile → straight into the app.
      // New / incomplete user → collect their details first.
      if (user.profile_complete) {
        this.done.emit();
      } else {
        // pre-fill anything the backend already knows
        this.name.set(user.name || '');
        this.email.set((user.email && !user.email.endsWith('@mylakshyas.local') && user.email) || '');
        this.city.set(user.city || '');
        this.age.set(user.age != null ? String(user.age) : '');
        this.step.set('details');
      }
    } catch (e: any) {
      this.error.set(this.friendly(e));
    } finally {
      this.busy.set(false);
    }
  }

  async saveDetails(): Promise<void> {
    if (!this.detailsValid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ageN = parseInt(this.age(), 10);
      await this.auth.saveProfile({
        name: this.name().trim(),
        email: this.email().trim(),
        age: Number.isFinite(ageN) ? ageN : null,
        city: this.city().trim(),
      });
      this.done.emit();
    } catch (e: any) {
      this.error.set(this.friendly(e));
    } finally {
      this.busy.set(false);
    }
  }

  editPhone(): void {
    this.step.set('phone');
    this.code.set('');
    this.error.set('');
  }

  async resend(): Promise<void> {
    this.error.set('');
    try {
      await this.auth.sendCode(this.phone());
    } catch (e: any) {
      this.error.set(this.friendly(e));
    }
  }

  private friendly(e: any): string {
    const m = (e?.message || '').toString();
    if (m.includes('invalid-verification-code')) return 'That code is not correct.';
    if (m.includes('too-many-requests')) return 'Too many attempts. Try again in a bit.';
    return m || 'Something went wrong. Please try again.';
  }
}
