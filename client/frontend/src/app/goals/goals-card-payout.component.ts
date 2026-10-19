import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';

import { GoalsService } from './goals.service';

/** The Monthly Payout card on the Goals hub (design "Monthly Payout Card"):
 *  a wall calendar with the payday pinned, a coin stack, the monthly figure and
 *  the next pay date — every number from GoalsService (real records). */
interface Day { t: string; cls: string; }
interface Coin { y: string; d: string; }
interface Pill { bg: string; sh: string; d: string; }

@Component({
  selector: 'app-goals-card-payout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goals-card-payout.component.html',
  styleUrls: ['./goals-card-payout.component.scss'],
})
export class GoalsCardPayoutComponent {
  readonly goals = inject(GoalsService);
  readonly ready = computed(() => !!this.goals.data());

  readonly next = computed(() => this.goals.nextPayday());
  readonly monTxt = computed(() => this.next().toLocaleString('en-IN', { month: 'long' }).toUpperCase());
  readonly yearTxt = computed(() => String(this.next().getFullYear()));
  readonly nextTxt = computed(() => this.next().toLocaleString('en-IN', { day: 'numeric', month: 'short' }));
  readonly moTxt = computed(() => this.goals.inr(this.goals.monthly()));
  readonly payDayTxt = computed(() => { const p = this.goals.payday(); return p + (p === 1 ? 'st' : p === 2 ? 'nd' : p === 3 ? 'rd' : 'th'); });
  readonly villasTxt = computed(() => { const n = this.goals.owned(); return n + (n === 1 ? ' villa' : ' villas'); });

  private readonly first = computed(() => new Date(this.next().getFullYear(), this.next().getMonth(), 1).getDay());
  private readonly dim = computed(() => new Date(this.next().getFullYear(), this.next().getMonth() + 1, 0).getDate());

  /** 35 cells: days before the payday struck through, the payday itself lit, Sundays amber */
  readonly days = computed<Day[]>(() => {
    const first = this.first(), dim = this.dim(), PAY = this.goals.payday();
    return Array.from({ length: 35 }, (_, i) => {
      const d = i - first + 1, on = d >= 1 && d <= dim;
      if (d === PAY) return { t: '', cls: 'pay' };
      if (d > 0 && d < PAY) return { t: String(d), cls: 'past' };
      return { t: on ? String(d) : '', cls: on ? (i % 7 === 0 ? 'sun' : 'on') : 'off' };
    });
  });
  /** the pin sits on the payday's cell (same arithmetic as the design) */
  readonly pinL = computed(() => (12 + ((this.first() + this.goals.payday() - 1) % 7) * (190 / 7) + 190 / 14) + 'px');
  readonly pinT = computed(() => (30 + 7 + 9 + 5 + Math.floor((this.first() + this.goals.payday() - 1) / 7) * 20 + 8) + 'px');

  readonly coins: Coin[] = Array.from({ length: 7 }, (_, i) => ({ y: (8 + i * 7) + 'px', d: (0.55 - i * 0.06).toFixed(2) + 's' })).reverse();
  readonly rings = [1, 2, 3, 4, 5];
  readonly pills: Pill[] = Array.from({ length: 12 }, (_, i) => ({
    bg: i === 0 ? 'linear-gradient(90deg,#fff3cf,#fbdb81)' : 'rgba(251,219,129,' + (0.55 - i * 0.035).toFixed(2) + ')',
    sh: i === 0 ? '0 0 10px rgba(251,219,129,.8)' : 'none', d: (i * 0.12) + 's',
  }));
}
