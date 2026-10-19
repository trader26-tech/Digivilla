import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';

import { AdminService, MappingOverview, VillaSummary, VillaType } from '../admin.service';

/**
 * Home: how many villas of each type clients hold, what they're worth today and
 * the commission they earn — plus a one-tap fix for villas with no type yet.
 */
@Component({
  selector: 'app-villa-sales',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './villa-sales.component.html',
  styleUrl: './villa-sales.component.scss',
})
export class VillaSalesComponent implements OnInit {
  private api = inject(AdminService);
  /** open a client's drawer on their Villas tab */
  @Output() openClient = new EventEmitter<string>();
  /** the home's one mapping overview, handed to the mapper; when it changes after
   *  the first load (a pin made anywhere), the tiles reload too */
  @Input() set overview(o: MappingOverview | null | undefined) {
    const had = !!this._overview;
    this._overview = o;
    if (had && o) this.load();
  }
  get overview(): MappingOverview | null | undefined { return this._overview; }
  private _overview: MappingOverview | null | undefined = undefined;
  /** a pin / type changed — the home reloads its mapping overview */
  @Output() mapped = new EventEmitter<void>();

  readonly data = signal<VillaSummary | null>(null);
  readonly error = signal('');
  readonly saving = signal<string | null>(null);
  readonly TYPES: { key: VillaType; label: string }[] = [
    { key: 'conservative', label: 'Conservative' }, { key: 'balanced', label: 'Balanced' }, { key: 'aggressive', label: 'Aggressive' },
  ];

  ngOnInit(): void { this.load(); }
  load(): void {
    this.api.villasSummary().subscribe({
      next: (d) => { this.data.set(d); this.error.set(''); },
      error: () => this.error.set('Could not load the villas.'),
    });
  }
  setType(villaId: string, t: VillaType): void {
    this.saving.set(villaId);
    this.api.setVillaType(villaId, t).subscribe({
      next: () => { this.saving.set(null); this.load(); },
      error: () => { this.saving.set(null); this.error.set('Could not save the type.'); },
    });
  }

  /** villas with no type, grouped by client */
  readonly unsetGroups = () => {
    const d = this.data();
    if (!d) return [];
    const by = new Map<string, { code: string; name: string; villas: VillaSummary['unset']['villas'] }>();
    for (const v of d.unset.villas) {
      const g = by.get(v.client_code) ?? { code: v.client_code, name: this.title(v.client_name), villas: [] };
      g.villas.push(v);
      by.set(v.client_code, g);
    }
    return [...by.values()];
  };
  title(s: string): string { return (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

  money(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
}
