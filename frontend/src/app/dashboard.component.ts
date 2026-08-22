import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { inr } from './format';
import { BasketStore } from './basket-store';
import { CompositionBarComponent } from './composition-bar.component';
import {
  DashboardFund,
  DashboardOverview,
  FundDetail,
  FundInfo,
  NavHistoryResponse,
} from './models';
import { NavHistoryChartComponent } from './nav-history-chart.component';
import { PlannerService } from './planner.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, NavHistoryChartComponent, CompositionBarComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  host: { '[class.embedded]': 'embedded' },
})
export class DashboardComponent implements OnInit {
  @Output() openBasket = new EventEmitter<void>();
  @Input() embedded = false;

  readonly store = inject(BasketStore);
  private api = inject(PlannerService);

  overview: DashboardOverview | null = null;
  loading = true;
  loadError: string | null = null;

  // Full list state
  funds: DashboardFund[] = [];
  total = 0;
  loadingList = false;

  // Filters
  private search$ = new Subject<void>();
  query = '';
  bucket = '';
  assetClass = '';
  sort = 'score';
  limit = 100;

  buckets: string[] = [];

  // Detail
  selectedFund: FundDetail | null = null;
  loadingDetail = false;
  nav: NavHistoryResponse | null = null;
  loadingNav = false;
  info: FundInfo | null = null;

  ngOnInit(): void {
    this.api.overview().subscribe({
      next: (o) => {
        this.overview = o;
        this.buckets = o.buckets.map((b) => b.bucket);
        this.loading = false;
        this.loadList();
      },
      error: () => {
        this.loadError = 'Could not load fund data. Is the API running and the cache generated?';
        this.loading = false;
      },
    });

    this.search$.pipe(debounceTime(250), distinctUntilChanged()).subscribe(() => this.loadList());
  }

  onFilterChange(): void {
    this.search$.next();
  }

  loadList(): void {
    this.loadingList = true;
    this.api
      .funds({
        q: this.query || undefined,
        bucket: this.bucket || undefined,
        asset_class: this.assetClass || undefined,
        sort: this.sort,
        limit: this.limit,
      })
      .subscribe({
        next: (r) => {
          this.funds = r.items;
          this.total = r.total;
          this.loadingList = false;
        },
        error: () => (this.loadingList = false),
      });
  }

  resetFilters(): void {
    this.query = '';
    this.bucket = '';
    this.assetClass = '';
    this.sort = 'score';
    this.loadList();
  }

  setSort(col: string): void {
    this.sort = col;
    this.loadList();
  }

  // --- detail ---
  openFund(f: DashboardFund | { scheme_code: number }): void {
    this.loadingDetail = true;
    this.selectedFund = null;
    this.nav = null;
    this.info = null;
    this.api.fundDetail(f.scheme_code).subscribe({
      next: (d) => {
        this.selectedFund = d;
        this.loadingDetail = false;
      },
      error: () => (this.loadingDetail = false),
    });
    this.loadingNav = true;
    this.api.navHistory(f.scheme_code).subscribe({
      next: (n) => {
        this.nav = n;
        this.loadingNav = false;
      },
      error: () => (this.loadingNav = false),
    });
    this.api.fundInfo(f.scheme_code).subscribe({
      next: (i) => (this.info = i),
      error: () => (this.info = null),
    });
  }
  closeFund(): void {
    this.selectedFund = null;
    this.nav = null;
    this.info = null;
  }

  // --- basket ---
  toggleBasket(f: DashboardFund, ev?: Event): void {
    ev?.stopPropagation();
    if (this.store.has(f.scheme_code)) this.store.remove(f.scheme_code);
    else this.store.addFund(f);
  }
  inBasket(code: number): boolean {
    return this.store.has(code);
  }

  // --- helpers ---
  fmtPct(v: number | null): string {
    if (v === null || v === undefined) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  }
  retClass(v: number | null): string {
    if (v === null || v === undefined) return 'muted';
    return v >= 0 ? 'pos' : 'neg';
  }
  stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  ratingClass(n: number): string {
    if (n >= 4) return 'r-high';
    if (n === 3) return 'r-mid';
    return 'r-low';
  }
  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)' }[a] ??
      'var(--accent)'
    );
  }
  fmtNav(v: number | null): string {
    return v === null || v === undefined ? '—' : `₹${v.toFixed(2)}`;
  }
  fmtInr = inr;
}
