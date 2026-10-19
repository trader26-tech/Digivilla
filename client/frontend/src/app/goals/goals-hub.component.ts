import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild, computed, inject, signal } from '@angular/core';

import { GoalsService } from './goals.service';
import { GoalsCardPayoutComponent } from './goals-card-payout.component';
import { GoalsCardCustomComponent } from './goals-card-custom.component';

/** The Goals hub (design "Goals Page"): what the villas pay for — the Monthly
 *  Payout card, the Homecoming card (+ its "What does the trip cost?" sheet),
 *  the "Your own goal" card and one card per saved custom goal. */
interface Chip { n: number; t: string; }
const SHEET_CLASS = 'tv-sheet-open';   // the shell hides its floating tab bar under a bottom sheet

@Component({
  selector: 'app-goals-hub',
  standalone: true,
  imports: [CommonModule, GoalsCardPayoutComponent, GoalsCardCustomComponent],
  templateUrl: './goals-hub.component.html',
  styleUrls: ['./goals-shared.scss', './goals-hub.component.scss'],
})
export class GoalsHubComponent implements OnDestroy {
  readonly goals = inject(GoalsService);
  @Output() back = new EventEmitter<void>();
  @Output() open = new EventEmitter<'payout' | 'trip-builder' | 'trip-fund' | 'create'>();

  readonly ready = computed(() => !!this.goals.data());
  readonly cardAmt = computed(() => this.goals.inr(this.goals.tripAmount()));

  // ── Homecoming sheet ──
  readonly sheet = signal(false);
  @ViewChild('sheetEl') sheetEl?: ElementRef<HTMLDialogElement>;
  /** the amount typed in the sheet (starts from the saved manual total) */
  readonly val = signal(0);
  readonly valTxt = computed(() => this.val() ? Math.round(this.val()).toLocaleString('en-IN') : '');
  readonly chips: Chip[] = [{ n: 100000, t: '₹1L' }, { n: 150000, t: '₹1.5L' }, { n: 250000, t: '₹2.5L' }, { n: 400000, t: '₹4L' }];

  openSheet(): void {
    this.val.set(this.goals.tripTotal()); this.sheet.set(true); document.body.classList.add(SHEET_CLASS);
    const d = this.sheetEl?.nativeElement; try { if (d && !d.open) d.showModal(); } catch { d?.setAttribute('open', ''); }
  }
  closeSheet(): void {
    this.sheet.set(false); document.body.classList.remove(SHEET_CLASS);
    const d = this.sheetEl?.nativeElement; try { if (d?.open) d.close(); } catch { /* already closed */ }
  }
  onInput(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const n = Math.min(99_999_999, +String(el.value).replace(/\D/g, '') || 0);
    this.val.set(n); el.value = n ? n.toLocaleString('en-IN') : '';
  }
  pick(n: number): void { this.val.set(n); }
  /** "Continue to checkout": keep the typed amount, go to the trip fund */
  go(): void { const v = this.val(); if (!v) return; this.goals.setTripTotal(v); this.closeSheet(); this.open.emit('trip-fund'); }
  /** "Estimate it for me": drop the typed amount, build it from the 4 parts */
  estimate(): void { this.goals.setTripTotal(0); this.closeSheet(); this.open.emit('trip-builder'); }

  removeGoal(id: string): void { this.goals.removeCustom(id); }
  ngOnDestroy(): void { this.closeSheet(); }
}
