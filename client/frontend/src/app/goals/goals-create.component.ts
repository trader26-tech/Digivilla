import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, computed, inject, signal } from '@angular/core';

import { GoalsService } from './goals.service';

/** the six goal kinds — label + an inline stroke icon (Phosphor-style, 24-box) */
interface Kind { key: string; t: string; icon: string; }
const KINDS: Kind[] = [
  { key: 'wedding', t: 'Wedding', icon: 'M12 7.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM9.5 7.5 8 4.5h8l-1.5 3M8 4.5l4 3 4-3' },
  { key: 'education', t: 'Education', icon: 'M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5zM6.5 11.5v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.5M21.5 9.5v6' },
  { key: 'car', t: 'Car', icon: 'M3 13.5 5.2 7.8A1.5 1.5 0 0 1 6.6 7h10.8a1.5 1.5 0 0 1 1.4.8L21 13.5M3 13.5h18v4.5h-2.5M3 18h2.5M5.5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.5 18h9' },
  { key: 'medical', t: 'Medical', icon: 'M3.5 7.5h17v12h-17zM8 7.5V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2.5M12 11v5M9.5 13.5h5' },
  { key: 'home', t: 'Home', icon: 'M3.5 11.5 12 4l8.5 7.5M5.5 10v10h13V10M10 20v-5.5h4V20' },
  { key: 'other', t: 'Other', icon: 'M12 3.5c.6 4.4 2.6 7.4 8.5 8.5-5.9 1.1-7.9 4.1-8.5 8.5-.6-4.4-2.6-7.4-8.5-8.5 5.9-1.1 7.9-4.1 8.5-8.5zM5 3.5c.2 1.4.9 2.3 2.5 2.5-1.6.2-2.3 1.1-2.5 2.5-.2-1.4-.9-2.3-2.5-2.5 1.6-.2 2.3-1.1 2.5-2.5z' },
];
const TYPES = ['One time', 'Every year', 'Every month'] as const;
const TYPE_HELP = [
  'A single big expense on a date, like a wedding or a car.',
  'Something that comes back every year, like school fees or a trip.',
  'A regular monthly need, like rent or a parent’s allowance.',
];
const ordinal = (n: number): string => {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
};

/** Create a goal: four steps (what · how much · how often · when), a live result
 *  card (villas to buy and what they pay), confirm sheet → buy request → toast. */
@Component({
  selector: 'app-goals-create',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goals-create.component.html',
  styleUrl: './goals-create.component.scss',
})
export class GoalsCreateComponent implements OnDestroy {
  readonly goals = inject(GoalsService);
  @Output() back = new EventEmitter<void>();
  @Output() done = new EventEmitter<void>();

  readonly kinds = KINDS;
  readonly types = TYPES;
  readonly kind = signal(0);
  readonly name = signal('');
  readonly amt = signal(500000);
  /** 0 one time · 1 every year · 2 every month */
  readonly type = signal<0 | 1 | 2>(0);
  /** months ahead (one time) · month index (every year) */
  readonly m = signal(24);
  readonly confirm = signal(false);
  readonly toast = signal(false);
  readonly paying = signal(false);
  readonly err = signal('');
  private tt: ReturnType<typeof setTimeout> | undefined;
  private readonly now = new Date();

  ngOnDestroy(): void { clearTimeout(this.tt); }

  // ── the figures (all from the service: income per villa, villa cost, payday) ──
  readonly amtTxt = computed(() => (this.amt() ? this.amt().toLocaleString('en-IN') : ''));
  readonly typeHelp = computed(() => TYPE_HELP[this.type()]);
  /** the clamped "when" value: months ahead 3…120, or month index 0…11 */
  readonly mm = computed(() => {
    const t = this.type(), m = this.m();
    return t === 0 ? Math.max(3, Math.min(120, m)) : t === 1 ? ((m % 12) + 12) % 12 : 0;
  });
  readonly villas = computed(() => {
    const t = this.type(), a = this.amt();
    return t === 0 ? this.goals.villasForOneTime(a, this.mm()) : t === 1 ? this.goals.villasForYearly(a) : this.goals.villasForMonthly(a);
  });
  readonly invest = computed(() => this.villas() * this.goals.villaCost());
  readonly investTxt = computed(() => this.goals.lakh(this.invest()));
  readonly villaIcons = computed(() => Array.from({ length: Math.min(this.villas(), 8) }, (_, i) => i));
  readonly villaLbl = computed(() => {
    const v = this.villas();
    return (v > 8 ? '+' + (v - 8) + ' · ' : '') + v + ' villa' + (v > 1 ? 's' : '') + ' · ' + this.goals.lakhShort(this.goals.villaCost()) + ' each';
  });
  readonly villaRowK = computed(() => `${this.villas()} villa${this.villas() > 1 ? 's' : ''} × ${this.goals.lakhShort(this.goals.villaCost())}`);
  readonly paydayTxt = computed(() => ordinal(this.goals.payday()));

  private mon(k: number, opt: Intl.DateTimeFormatOptions): string {
    return new Date(this.now.getFullYear(), this.now.getMonth() + k, 1).toLocaleString('en-IN', opt);
  }
  /** everything that depends on the type: the question, the stepper text, the rows and the note */
  readonly when = computed(() => {
    const t = this.type(), mm = this.mm(), amt = this.amt(), v = this.villas(), MO = this.goals.perVillaMonth();
    const fmt = (n: number) => this.goals.inr(n);
    if (t === 0) {
      const yrs = Math.floor(mm / 12), rem = mm % 12, got = v * MO * mm;
      const sub = 'in ' + (yrs ? yrs + ' year' + (yrs > 1 ? 's' : '') : '') + (yrs && rem ? ' ' : '') + (rem ? rem + ' month' + (rem > 1 ? 's' : '') : '');
      return {
        q: 'When do you need it?', k: 'Ready by', txt: this.mon(mm, { month: 'long', year: 'numeric' }), sub,
        prevOn: mm > 3, nextOn: mm < 120,
        rows: [
          { k: 'Payout every month', v: fmt(v * MO), green: true },
          { k: 'Collected by ' + this.mon(mm, { month: 'short', year: 'numeric' }), v: fmt(got), green: false },
          { k: 'Your goal', v: fmt(amt), green: false },
        ],
        note: 'Payouts add up to ' + fmt(got) + ' by ' + this.mon(mm, { month: 'long', year: 'numeric' }) + '. You still own the ' + v + ' villa' + (v > 1 ? 's' : '') + ' after.',
      };
    }
    if (t === 1) {
      const mt = new Date(2000, mm, 1).toLocaleString('en-IN', { month: 'long' }), yr = v * MO * 12;
      return {
        q: 'Which month each year?', k: 'Paid each', txt: mt, sub: 'every year, starting ' + (this.now.getFullYear() + 1),
        prevOn: true, nextOn: true,
        rows: [
          { k: 'Villas pay you a year', v: fmt(yr), green: true },
          { k: 'Your goal each year', v: fmt(amt), green: false },
          { k: 'Left over each year', v: fmt(yr - amt), green: false },
        ],
        note: 'Covers ' + fmt(amt) + ' every ' + mt + ', for as long as you hold the villas.',
      };
    }
    const mo = v * MO;
    return {
      q: 'Payday each month', k: 'Paid on', txt: this.paydayTxt() + ' of every month', sub: 'starts ' + this.mon(1, { month: 'long', year: 'numeric' }),
      prevOn: false, nextOn: false,
      rows: [
        { k: 'Villas pay you a month', v: fmt(mo), green: true },
        { k: 'Your goal each month', v: fmt(amt), green: false },
        { k: 'Left over each month', v: fmt(mo - amt), green: false },
      ],
      note: 'A steady ' + fmt(mo) + ' lands on the ' + this.paydayTxt() + ', every month.',
    };
  });
  readonly nameShown = computed(() => this.name().trim() || KINDS[this.kind()].t);
  readonly ctaTxt = computed(() => (this.amt() ? 'Create goal · ' + this.investTxt() : 'Enter an amount'));

  // ── actions ──
  pickKind(i: number): void { this.kind.set(i); }
  onName(e: Event): void { this.name.set((e.target as HTMLInputElement).value.slice(0, 40)); }
  onAmt(e: Event): void {
    const el = e.target as HTMLInputElement;
    const n = Math.min(99_999_999, +String(el.value).replace(/\D/g, '') || 0);
    this.amt.set(n);
    el.value = n ? n.toLocaleString('en-IN') : '';   // format live, as typed
  }
  pickType(i: 0 | 1 | 2): void { this.type.set(i); this.m.set(i === 0 ? 24 : i === 1 ? this.now.getMonth() : 0); }
  step(d: number): void {
    if (this.type() === 2) return;
    const mm = this.mm();
    this.m.set(this.type() === 0 ? Math.max(3, Math.min(120, mm + d)) : mm + d);
  }
  save(): void { if (this.amt()) { this.err.set(''); this.confirm.set(true); } }
  closeConfirm(): void { if (!this.paying()) this.confirm.set(false); }
  pay(): void {
    if (this.paying()) return;
    const kind = KINDS[this.kind()].key, name = this.nameShown(), amount = this.amt(), type = this.type(), m = this.mm(), villas = this.villas();
    const how = ['one time', 'every year', 'every month'][type];
    this.paying.set(true); this.err.set('');
    this.goals.requestVillas(villas, null, `Goal: ${name} — ${this.goals.inr(amount)} ${how}`).subscribe({
      next: () => {
        this.goals.addCustom({ kind, name, amount, type, m, villas });
        this.paying.set(false); this.confirm.set(false); this.toast.set(true);
        clearTimeout(this.tt);
        this.tt = setTimeout(() => { this.toast.set(false); this.done.emit(); }, 1600);
      },
      error: () => { this.paying.set(false); this.err.set('Could not send the request. Please try again.'); },
    });
  }
}
