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

import { EstateService, VillaSipDetail, VillaSipItem } from './estate.service';

/**
 * "Villa SIP" preview modal — a centered card over a dark scrim with two states:
 *
 *   PICKER ("Choose A Bucket"): a list of the available buckets from /villas/sip,
 *   each a row with the name (bold), a SIP / LUMPSUM pill, tier, subtitle and
 *   fund count. Tapping a row loads its detail and switches to DETAIL.
 *
 *   DETAIL: the canonical fund mix behind one bucket:
 *     Sip - <Name>  |  Lumpsum - <Name>
 *     medium risk portfolio                    ← grey subtitle (falls back to
 *                                                the allocation summary)
 *     Scheme Name | Category | Allocation | Past Returns (p.a.) [1Yr · 3Yr · 5Yr]
 *     …one row per fund, returns in green…
 *     Overall Portfolio Returns | | 100% | 1Yr · 3Yr · 5Yr   (bold footer)
 *
 * Data comes from EstateService (/villas/sip + /villas/sip/{id}); nothing is
 * hardcoded. Pass a villaId to open one bucket directly (no picker); otherwise
 * the list is fetched: one bucket opens directly, many show the picker (with a
 * name hint used to preselect, if given).
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

  /** Which face is showing: the bucket picker, or one bucket's detail table. */
  readonly mode = signal<'picker' | 'detail'>('detail');
  /** The available buckets (only populated/used in the picker state). */
  readonly villas = signal<VillaSipItem[]>([]);
  readonly detail = signal<VillaSipDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);

  /** Title. In the picker it's "Choose A Bucket". In detail it uses `kind`:
   *  lumpsum → "Lumpsum - <Name>", else "Sip - <Name>". While loading the
   *  detail, falls back to the name hint. */
  readonly title = computed<string>(() => {
    if (this.mode() === 'picker') return 'Choose A Bucket';
    const d = this.detail();
    const name = d?.name || this.villaName || '';
    if (!name) return 'Sip';
    const prefix = d?.kind === 'lumpsum' ? 'Lumpsum' : 'Sip';
    return `${prefix} - ${name}`;
  });

  /** Grey subtitle under the title, e.g. "medium risk portfolio". Falls back to
   *  the allocation summary ("36%, 24%, …") when the server sends no subtitle. */
  readonly subtitle = computed<string>(() => {
    const d = this.detail();
    if (!d) return '';
    return (d.subtitle && d.subtitle.trim()) || this.allocSummary();
  });

  /** Subtle allocation summary line, e.g. "36%, 24%, 16%, 12%, 12%". */
  readonly allocSummary = computed<string>(() => {
    const d = this.detail();
    if (!d) return '';
    return d.funds.map((f) => this.fmtAlloc(f.allocation)).join(', ');
  });

  ngOnInit(): void {
    this.lockScroll(true);
    // An explicit id opens that bucket straight into the detail table.
    if (this.villaId) {
      this.loadDetail(this.villaId);
      return;
    }
    // No id: fetch the list. One bucket opens directly; many show the picker.
    this.loading.set(true);
    this.error.set(false);
    this.api.villaSipList().subscribe({
      next: (r) => {
        const villas = r.villas || [];
        if (!villas.length) {
          this.fail();
          return;
        }
        this.villas.set(villas);
        if (villas.length === 1) {
          // Only one bucket — skip the picker, open it directly.
          this.loadDetail(villas[0].id);
          return;
        }
        // Many buckets — show the picker (preselecting nothing; the name hint
        // is left for the user to spot, matching the reference flow).
        this.mode.set('picker');
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  /** Picker → detail: load and show the tapped bucket's fund mix. */
  pick(v: VillaSipItem): void {
    this.mode.set('detail');
    this.loadDetail(v.id);
  }

  /** Detail → picker: return to the list (only when there is one to return to). */
  back(): void {
    if (!this.canGoBack()) return;
    this.detail.set(null);
    this.error.set(false);
    this.loading.set(false);
    this.mode.set('picker');
  }

  /** True when a picker list exists to return to (i.e. the modal wasn't opened
   *  on a single explicit bucket). */
  canGoBack(): boolean {
    return !this.villaId && this.villas().length > 1;
  }

  /** A short SIP / LUMPSUM label for a bucket's pill. */
  kindLabel(v: VillaSipItem): string {
    return v.kind === 'lumpsum' ? 'LUMPSUM' : 'SIP';
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
