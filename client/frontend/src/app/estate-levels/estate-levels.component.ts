import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

/**
 * Progress page — an EXACT reproduction of the design documentation
 * (admin-docs/Progress Page (complete).html, the #scr-progress screen).
 *
 * Payment-history framing: monthly income, build-out SIP, a 5-payment
 * timeline, "money you kept" vs buying flats, and a talk-to-your-fund-manager
 * row. Three tap-open detail modals: income breakdown, book-a-call, and the
 * money-you-kept cost breakdown. Values are the design's own (illustrative),
 * reproduced verbatim.
 */
@Component({
  selector: 'app-estate-levels',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './estate-levels.component.html',
  styleUrl: './estate-levels.component.scss',
})
export class EstateLevelsComponent {
  @Output() back = new EventEmitter<void>();
  /** True when shown as a bottom-nav TAB (no back button, reserves nav space). */
  @Input() tab = false;

  onBack(): void { this.back.emit(); }

  /** Which detail modal is open, or null. */
  modal = signal<null | 'in' | 'call' | 'saved' | 'out'>(null);
  openModal(m: 'in' | 'call' | 'saved' | 'out'): void {
    this.modal.set(m);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  closeModal(): void { this.modal.set(null); this.slotName.set(''); }

  /** Book-a-call: the chosen slot label (shows the confirmation line). */
  slotName = signal('');
  pickSlot(label: string): void {
    this.slotName.set(label);
    if (navigator.vibrate) navigator.vibrate([6, 20, 6]);
  }
}
