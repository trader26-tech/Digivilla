import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  inject,
} from '@angular/core';

import { GoalPreset } from './models';
import { FirebaseAuthService } from './firebase-auth.service';

/**
 * Home screen shown right after a goal is added. It shows the new goal, then a
 * "one last step" bottom sheet slides up: enter your name + phone, receive an
 * OTP (via Firebase phone auth), verify it, and you're in.
 */
@Component({
  selector: 'app-goal-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './goal-home.component.html',
  styleUrl: './goal-home.component.scss',
})
export class GoalHomeComponent implements OnInit {
  @Input({ required: true }) goal!: GoalPreset;
  @Input() amount = 0;       // target corpus
  @Input() monthly = 0;      // monthly SIP
  @Input() years = 0;

  /** Emitted once the user is verified — carries their name + phone. */
  @Output() loggedIn = new EventEmitter<{ name: string; phone: string }>();

  /** Invisible reCAPTCHA host for Firebase phone auth. */
  @ViewChild('recaptcha') recaptchaEl?: ElementRef<HTMLElement>;

  readonly fb = inject(FirebaseAuthService);

  entered = false;
  sheetOpen = false;

  /** Two-step sheet: 'details' (name + phone) -> 'otp' (6-digit code). */
  step: 'details' | 'otp' = 'details';
  name = '';
  phone = '';
  otp = '';
  sending = false;    // waiting on sendCode
  verifying = false;  // waiting on verifyCode
  error = '';

  ngOnInit(): void {
    setTimeout(() => (this.entered = true), 40);
    // let the home settle, then slide the login sheet up
    setTimeout(() => (this.sheetOpen = true), 900);
  }

  get validName(): boolean {
    return this.name.trim().length >= 2;
  }
  get validPhone(): boolean {
    return /^[6-9]\d{9}$/.test(this.phone.replace(/\D/g, ''));
  }
  get validOtp(): boolean {
    return /^\d{6}$/.test(this.otp);
  }
  get canSend(): boolean {
    return this.validName && this.validPhone && !this.sending;
  }

  onName(v: string): void {
    this.name = v.replace(/[^\p{L}\s.'-]/gu, '').slice(0, 40);
    this.error = '';
  }
  onPhone(v: string): void {
    this.phone = v.replace(/\D/g, '').slice(0, 10);
    this.error = '';
  }
  onOtp(v: string): void {
    this.otp = v.replace(/\D/g, '').slice(0, 6);
    this.error = '';
  }

  /** Step 1 -> send the OTP to their phone. */
  async sendCode(): Promise<void> {
    if (!this.canSend) return;
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

  /** Step 2 -> verify the code and finish. */
  async verify(): Promise<void> {
    if (!this.validOtp || this.verifying) return;
    this.verifying = true;
    this.error = '';
    try {
      await this.fb.verifyCode(this.otp);
      if (navigator.vibrate) navigator.vibrate(12);
      this.loggedIn.emit({ name: this.name.trim(), phone: this.phone });
    } catch (e: any) {
      this.error = e?.message || 'That code didn\'t match. Check and retry.';
    } finally {
      this.verifying = false;
    }
  }

  /** Back from OTP to the name/phone step. */
  editDetails(): void {
    this.step = 'details';
    this.otp = '';
    this.error = '';
    this.fb.reset();
  }

  compactInr(v: number): string {
    if (v >= 10_000_000) {
      const cr = v / 10_000_000;
      return `₹${cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')} Cr`;
    }
    if (v >= 100_000) {
      const l = v / 100_000;
      return `₹${l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')} L`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }
  fullInr(v: number): string {
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  hue(): number {
    return HUE_OF[this.goal?.key] ?? 262;
  }
}

const HUE_OF: Record<string, number> = {
  emergency: 190, health: 356, car: 205, wedding: 330, vacation: 25,
  gadget: 262, house: 222, child_education: 262, retirement: 28, wealth: 150,
};
