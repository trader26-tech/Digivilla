import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  inject,
} from '@angular/core';

import { AuthResponse } from './models';
import { FirebaseAuthService } from './firebase-auth.service';
import { PlannerService } from './planner.service';

/**
 * The screen shown right after the intro: a text-only "why MyLakshyas matters"
 * pitch with two clear paths —
 *   • "Log in"      → returning users authenticate (phone + OTP) and go straight
 *                     to the dashboard, skipping the whole goal-building flow.
 *   • "Get started" → new users begin the goal flow.
 */
@Component({
  selector: 'app-welcome-gate',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './welcome-gate.component.html',
  styleUrl: './welcome-gate.component.scss',
})
export class WelcomeGateComponent {
  /** New user chose to build their first goal. */
  @Output() getStarted = new EventEmitter<void>();
  /** Returning user authenticated — hand the session up to the shell. */
  @Output() loggedIn = new EventEmitter<AuthResponse>();

  @ViewChild('recaptcha') recaptchaEl?: ElementRef<HTMLElement>;

  private fb = inject(FirebaseAuthService);
  private api = inject(PlannerService);

  entered = false;
  /** The login sheet overlay. */
  loginOpen = false;
  step: 'phone' | 'otp' = 'phone';
  phone = '';
  otp = '';
  sending = false;
  verifying = false;
  error = '';

  constructor() {
    setTimeout(() => (this.entered = true), 30);
  }

  get isMock(): boolean {
    return this.fb.isMock;
  }
  get validPhone(): boolean {
    return /^[6-9]\d{9}$/.test(this.phone.replace(/\D/g, ''));
  }
  get validOtp(): boolean {
    return /^\d{6}$/.test(this.otp);
  }

  onPhone(v: string): void {
    this.phone = v.replace(/\D/g, '').slice(0, 10);
    this.error = '';
  }
  onOtp(v: string): void {
    this.otp = v.replace(/\D/g, '').slice(0, 6);
    this.error = '';
  }

  // ---- entry: everyone logs in (phone + OTP), then lands on Home ----
  start(): void {
    this.openLogin();
  }

  openLogin(): void {
    this.loginOpen = true;
    this.step = 'phone';
    this.error = '';
  }
  closeLogin(): void {
    this.loginOpen = false;
    this.otp = '';
    this.fb.reset();
  }

  /** Step 1 → send the OTP. */
  async sendCode(): Promise<void> {
    if (!this.validPhone || this.sending) return;
    this.sending = true;
    this.error = '';
    if (navigator.vibrate) navigator.vibrate(8);
    try {
      const host = this.recaptchaEl?.nativeElement ?? document.body;
      await this.fb.sendCode('+91' + this.phone, host);
      this.step = 'otp';
    } catch (e: any) {
      this.error = e?.message || 'Could not send the code. Try again.';
    } finally {
      this.sending = false;
    }
  }

  /** Step 2 → verify + exchange for a real session at /auth/phone. */
  async verify(): Promise<void> {
    if (!this.validOtp || this.verifying) return;
    this.verifying = true;
    this.error = '';
    try {
      const user = await this.fb.verifyCode(this.otp);
      // Empty name for a returning user — the backend keeps their stored name.
      this.api
        .phoneLogin('', this.phone, user.idToken === 'mock' ? '' : user.idToken)
        .subscribe({
          next: (res) => {
            if (navigator.vibrate) navigator.vibrate(12);
            this.loggedIn.emit(res);
          },
          error: (e) => {
            this.verifying = false;
            this.error = e?.error?.detail || 'Login failed. Please try again.';
          },
        });
    } catch (e: any) {
      this.verifying = false;
      this.error = e?.message || 'That code didn\'t match. Check and retry.';
    }
  }

  editPhone(): void {
    this.step = 'phone';
    this.otp = '';
    this.error = '';
    this.fb.reset();
  }
}
