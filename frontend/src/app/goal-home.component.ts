import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
} from '@angular/core';

import { GoalPreset } from './models';

/**
 * Dummy home screen shown right after a goal is added. It shows the new goal
 * with its invested amount / monthly SIP / target, then a quick-login bottom
 * sheet slides up asking for a phone number to unlock the full dashboard.
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

  /** Emitted when the quick login is submitted (phone captured). */
  @Output() loggedIn = new EventEmitter<string>();

  entered = false;
  sheetOpen = false;
  phone = '';

  ngOnInit(): void {
    setTimeout(() => (this.entered = true), 40);
    // let the home settle, then slide the login sheet up
    setTimeout(() => (this.sheetOpen = true), 900);
  }

  get validPhone(): boolean {
    return /^[6-9]\d{9}$/.test(this.phone.replace(/\D/g, ''));
  }

  onPhone(v: string): void {
    this.phone = v.replace(/\D/g, '').slice(0, 10);
  }

  submit(): void {
    if (!this.validPhone) return;
    if (navigator.vibrate) navigator.vibrate(8);
    this.loggedIn.emit(this.phone);
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
