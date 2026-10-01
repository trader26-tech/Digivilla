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
    { title: 'FD vs DigiVilla', sub: 'Same money: bank FD or DigiVilla', art: 'bank', glow: 'rgba(143,183,176,.28)', key: 'fd' },
    { title: 'Flat vs DigiVilla', sub: 'Rent out a flat, or own DigiVilla', art: 'flat-building', glow: 'rgba(201,198,218,.24)', key: 'flat' },
  ] },
  { title: 'Grow', items: [
    { title: 'SIP into DigiVilla', sub: 'What a monthly SIP builds', art: 'sip', glow: 'rgba(145,132,217,.3)', key: 'sip' },
    { title: 'Lumpsum into DigiVilla', sub: 'Invest once, earn monthly', art: 'coin', glow: 'rgba(233,193,92,.3)', key: 'lump' },
  ] },
  { title: 'Test', items: [
    { title: 'My portfolio vs DigiVilla', sub: 'Upload your CAS, see what DigiVilla would have done', art: 'cas', glow: 'rgba(233,193,92,.26)', key: null },
  ] },
];

/** The hub's cards rise in once per session, not on every return to the tab. */
let seenHub = false;

/**
 * Compare — the 4th bottom-nav tab: "What would DigiVilla do for you?"
 * Tiles grouped Compare / Grow / Test (two-up, the last one wide). FD vs DigiVilla, Flat vs
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
  /** true while a calculator is open — the app hides the tab bar so it gets the whole screen */
  @Output() calcOpen = new EventEmitter<boolean>();

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
      this.calcOpen.emit(true);
      window.scrollTo({ top: 0 });
      return;
    }
    clearTimeout(this.toastTimer);
    this.toast.set(`${c.title} · coming up`);
    this.toastTimer = setTimeout(() => this.toast.set(''), 1800);
  }

  close(): void {
    this.open.set(null);
    this.calcOpen.emit(false);
    window.scrollTo({ top: 0 });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
    if (this.open()) this.calcOpen.emit(false);
  }
}
