import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Output, ViewChild, computed, inject, signal } from '@angular/core';

import { EstateService, Tile } from '../estate.service';
import { centreTile } from '../estate/board-layout';
import { compact } from '../shared/format.util';

/** A row in the transaction history. */
interface Txn {
  id: string;
  kind: 'villa' | 'land' | 'building';
  label: string;
  amount: number;
  at: number;      // epoch ms
}

/**
 * Account page. Opened from the home avatar. Shows the user's profile (photo —
 * uploadable here, name, phone, city) and every transaction they've made,
 * newest first. No bottom nav.
 */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss',
})
export class AccountComponent {
  @Output() back = new EventEmitter<void>();
  /** Asks the shell to sign the user out. */
  @Output() signOut = new EventEmitter<void>();
  @ViewChild('photoInput') photoInput?: ElementRef<HTMLInputElement>;

  readonly est = inject(EstateService);
  compact = compact;

  /** Transactions are hidden until the user taps to reveal them. */
  showTxns = signal(false);
  toggleTxns(): void { this.showTxns.update((v) => !v); }

  onSignOut(): void { this.signOut.emit(); }

  /** Transactions from every owned asset (incl. the founding villa), newest
   *  first. Each purchase is one debit. */
  readonly txns = computed<Txn[]>(() => {
    const all: Tile[] = [centreTile(), ...this.est.tiles()];
    return all
      .map((t) => ({
        id: t.id,
        kind: t.type,
        label: t.label,
        amount: t.type === 'building' ? t.sipAccrued : t.cost,
        at: t.boughtAt,
      }))
      .sort((a, b) => b.at - a.at);
  });

  /** Total invested across all assets. */
  get totalInvested(): number {
    return this.txns().reduce((s, t) => s + t.amount, 0);
  }

  kindLabel(k: Txn['kind']): string {
    return k === 'villa' ? 'Villa' : k === 'land' ? 'Land' : 'Under construction';
  }

  // --- photo upload (same technique as the home avatar) ---
  pickPhoto(): void {
    this.photoInput?.nativeElement.click();
  }
  onPhotoChosen(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const photo = typeof reader.result === 'string' ? reader.result : undefined;
      if (photo) this.est.setProfile({ photo });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  onBack(): void { this.back.emit(); }
  trackTxn(_i: number, t: Txn): string { return t.id; }
}
