import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';

import { EstateService, VillaSipDetail } from './estate.service';

/**
 * "Villa SIP" preview modal — a centered card over a dark scrim that renders the
 * canonical fund mix behind a villa:
 *
 *   Sip - <Villa Name>
 *   36, 24, 16, 12, 12                         ← subtle allocation summary
 *   Scheme Name | Category | Allocation | Past Returns (p.a.) [1Yr · 3Yr · 5Yr]
 *   …one row per fund, returns in green…
 *   Overall Portfolio Returns | | 100% | 1Yr · 3Yr · 5Yr   (bold footer)
 *
 * Data comes from EstateService (/villas/sip + /villas/sip/{id}); nothing is
 * hardcoded. Pass a villaId to load a specific villa, or a villaName hint to
 * match one by name from the list (else the first villa).
 */
@Component({
  selector: 'app-villa-sip-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './villa-sip-modal.component.html',
  styleUrl: './villa-sip-modal.component.scss',
})
export class VillaSipModalComponent implements OnInit, OnDestroy {
  /** Load this canonical villa directly, if known. */
  @Input() villaId?: string;
  /** Otherwise match a villa whose name contains this (case-insensitive). */
  @Input() villaName?: string;
  @Output() close = new EventEmitter<void>();

  private api = inject(EstateService);

  readonly detail = signal<VillaSipDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);

  /** Title: "Sip - <Villa Name>", falling back to any name hint while loading. */
  readonly title = computed<string>(() => {
    const name = this.detail()?.name || this.villaName || '';
    return name ? `Sip - ${name}` : 'Sip';
  });

  /** Subtle allocation summary line, e.g. "36, 24, 16, 12, 12". */
  readonly allocSummary = computed<string>(() => {
    const d = this.detail();
    if (!d) return '';
    return d.funds.map((f) => this.fmtAlloc(f.allocation)).join(', ');
  });

  ngOnInit(): void {
    this.lockScroll(true);
    if (this.villaId) {
      this.loadDetail(this.villaId);
      return;
    }
    // No id: pick the villa whose name matches villaName (contains, case-
    // insensitive), else the first one in the list.
    this.api.villaSipList().subscribe({
      next: (r) => {
        const villas = r.villas || [];
        if (!villas.length) {
          this.fail();
          return;
        }
        const hint = (this.villaName || '').trim().toLowerCase();
        const match =
          (hint && villas.find((v) => v.name.toLowerCase().includes(hint))) ||
          villas[0];
        this.loadDetail(match.id);
      },
      error: () => this.fail(),
    });
  }

  ngOnDestroy(): void {
    this.lockScroll(false);
  }

  private loadDetail(id: string): void {
    this.loading.set(true);
    this.error.set(false);
    this.api.villaSip(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  private fail(): void {
    this.error.set(true);
    this.loading.set(false);
  }

  /** Format a return as "X.XX%", or "—" when there's no history. */
  fmtRet(v: number | null | undefined): string {
    return v == null ? '—' : `${v.toFixed(2)}%`;
  }

  /** Format an allocation percent — whole numbers stay clean (36%, not 36.0%). */
  fmtAlloc(v: number | null | undefined): string {
    if (v == null) return '—';
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
  }

  onScrim(): void {
    this.close.emit();
  }
  onClose(): void {
    this.close.emit();
  }

  /** Prevent the page behind the modal from scrolling while it's open. */
  private lockScroll(on: boolean): void {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = on ? 'hidden' : '';
  }
}
