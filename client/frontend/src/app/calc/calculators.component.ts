import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, inject, signal } from '@angular/core';

import { CalcDataService } from './calc-data.service';
import { FdVsDvComponent } from './fd-vs-dv.component';
import { FlatCalcComponent } from './flat-calc.component';
import { LumpsumCalcComponent } from './lumpsum-calc.component';
import { SipCalcComponent } from './sip-calc.component';

type CalcKey = 'fd' | 'sip' | 'flat' | 'lump';

interface CalcCard {
  title: string;
  sub: string;
  art: string;
  glow: string;
  /** which calculator it opens; null = not built yet */
  key: CalcKey | null;
}

const GROUPS: { title: string; items: CalcCard[] }[] = [
  { title: 'Compare', items: [
    { title: 'FD vs DigiVilla', sub: 'Same money in a bank deposit or a villa', art: 'bank', glow: 'rgba(143,183,176,.14)', key: 'fd' },
    { title: 'Flat vs DigiVilla', sub: 'Buying a flat to rent out, or a villa', art: 'flat-building', glow: 'rgba(201,198,218,.12)', key: 'flat' },
  ] },
  { title: 'Grow', items: [
    { title: 'SIP', sub: 'What a monthly amount becomes', art: 'sip', glow: 'rgba(145,132,217,.16)', key: 'sip' },
    { title: 'Lumpsum', sub: 'What a one-time amount becomes', art: 'coin', glow: 'rgba(233,193,92,.16)', key: 'lump' },
  ] },
  { title: 'Test', items: [
    { title: 'My portfolio vs DigiVilla', sub: 'Upload your CAS · same cash flows, same dates', art: 'cas', glow: 'rgba(233,193,92,.14)', key: null },
  ] },
];

/** The hub's cards rise in once per session, not on every return to the tab. */
let seenHub = false;

/**
 * Compare — the 4th bottom-nav tab: "What would DigiVilla do for you?"
 * A list of calculators grouped Compare / Grow / Test. FD vs DigiVilla, Flat vs
 * DigiVilla, SIP and Lumpsum are built (all replay today's DigiVilla mix on real past NAVs); the rest are
 * marked "Soon". Tapping one opens it in place (its back arrow returns here).
 * The fund history is fetched as the hub opens, so a calculator paints once.
 */
@Component({
  selector: 'app-calculators',
  standalone: true,
  imports: [CommonModule, FdVsDvComponent, FlatCalcComponent, LumpsumCalcComponent, SipCalcComponent],
  templateUrl: './calculators.component.html',
  styleUrls: ['./calculators.component.scss'],
  host: { '[class.calc-open]': 'open() !== null' },
})
export class CalculatorsComponent implements OnDestroy {
  /** "Talk to us" — the app opens the booking flow. */
  @Output() talk = new EventEmitter<void>();

  readonly groups = GROUPS;
  readonly open = signal<CalcKey | null>(null);
  readonly toast = signal('');
  readonly enter = !seenHub;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    seenHub = true;
    inject(CalcDataService).load();
  }

  pick(c: CalcCard): void {
    if (c.key) {
      this.open.set(c.key);
      window.scrollTo({ top: 0 });
      return;
    }
    clearTimeout(this.toastTimer);
    this.toast.set(`${c.title} · coming soon`);
    this.toastTimer = setTimeout(() => this.toast.set(''), 1800);
  }

  close(): void {
    this.open.set(null);
    window.scrollTo({ top: 0 });
  }

  ngOnDestroy(): void { clearTimeout(this.toastTimer); }
}
