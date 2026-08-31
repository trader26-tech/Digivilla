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

  step = signal<'phone' | 'otp'>('phone');
  name = signal('');
  phone = signal('');
  code = signal('');
  busy = signal(false);
  error = signal('');

  get firebaseReady(): boolean { return this.auth.firebaseReady; }

  get phoneValid(): boolean {
    return this.phone().replace(/\D/g, '').length >= 10;
  }
  get codeValid(): boolean {
    return this.code().replace(/\D/g, '').length === 6;
  }

  async sendCode(): Promise<void> {
    if (!this.phoneValid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.sendCode(this.name(), this.phone());
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
      await this.auth.verifyCode(this.code());
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
      await this.auth.sendCode(this.name(), this.phone());
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
