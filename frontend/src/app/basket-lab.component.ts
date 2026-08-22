import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { inr } from './format';
import { BasketStore } from './basket-store';
import { BasketChartsComponent } from './basket-charts.component';
import { CompositionBarComponent } from './composition-bar.component';
import { DashboardComponent } from './dashboard.component';
import {
  BasketItem,
  BasketMetrics,
  DashboardFund,
  FundDetail,
  FundInfo,
  Goal,
  ModelBasket,
  NavHistoryResponse,
} from './models';
import { NavHistoryChartComponent } from './nav-history-chart.component';
import { PlannerService } from './planner.service';

@Component({
  selector: 'app-basket-lab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CompositionBarComponent,
    BasketChartsComponent,
    NavHistoryChartComponent,
    DashboardComponent,
  ],
  templateUrl: './basket-lab.component.html',
  styleUrl: './basket-lab.component.scss',
})
export class BasketLabComponent implements OnInit {
  @Output() saved = new EventEmitter<void>();

  readonly store = inject(BasketStore);
  private api = inject(PlannerService);

  goals: Goal[] = [];
  models: ModelBasket[] = [];
  metricsByKey: Record<string, BasketMetrics> = {};
  seriesByKey: Record<string, BasketMetrics> = {}; // with growth/drawdown/yearly
  loadingSeries: string | null = null;
  expanded: string | null = null;
  savingKey: string | null = null;
  savedKey: string | null = null;

  // fund search & compare tray
  compare: DashboardFund[] = [];
  private search$ = new Subject<string>();
  query = '';
  results: DashboardFund[] = [];
  searching = false;

  // basket compare (hidden until toggled)
  showBasketCompare = false;
  basketCompareKeys: string[] = [];

  // fund detail (asset info)
  fund: FundDetail | null = null;
  fundInfo: FundInfo | null = null;
  fundNav: NavHistoryResponse | null = null;
  loadingFund = false;
  loadingFundNav = false;

  ngOnInit(): void {
    this.api.goals().subscribe((g) => (this.goals = g));
    this.api.modelBaskets().subscribe((m) => {
      this.models = m;
      m.forEach((mb) => this.analyze(mb));
    });

    this.search$.pipe(debounceTime(250), distinctUntilChanged()).subscribe((q) => {
      if (!q || q.length < 2) {
        this.results = [];
        return;
      }
      this.searching = true;
      this.api.funds({ q, limit: 8 }).subscribe({
        next: (r) => {
          this.results = r.items;
          this.searching = false;
        },
        error: () => (this.searching = false),
      });
    });
  }

  private analyze(m: ModelBasket): void {
    this.api
      .analyzeBasket(m.items.map((i) => ({ scheme_code: i.scheme_code, weight: i.weight })))
      .subscribe((res) => (this.metricsByKey[m.key] = res));
  }

  toggle(key: string): void {
    this.expanded = this.expanded === key ? null : key;
    if (this.expanded && !this.seriesByKey[key]) this.loadSeries(key);
  }

  private loadSeries(key: string): void {
    const m = this.models.find((x) => x.key === key);
    if (!m) return;
    this.loadingSeries = key;
    this.api
      .analyzeBasket(
        m.items.map((i) => ({ scheme_code: i.scheme_code, weight: i.weight })),
        true,
      )
      .subscribe({
        next: (res) => {
          this.seriesByKey[key] = res;
          this.loadingSeries = null;
        },
        error: () => (this.loadingSeries = null),
      });
  }

  // fund → asset detail
  openFund(schemeCode: number): void {
    this.loadingFund = true;
    this.fund = null;
    this.fundInfo = null;
    this.fundNav = null;
    this.api.fundDetail(schemeCode).subscribe({
      next: (d) => {
        this.fund = d;
        this.loadingFund = false;
      },
      error: () => (this.loadingFund = false),
    });
    this.api.fundInfo(schemeCode).subscribe({ next: (i) => (this.fundInfo = i) });
    this.loadingFundNav = true;
    this.api.navHistory(schemeCode).subscribe({
      next: (n) => {
        this.fundNav = n;
        this.loadingFundNav = false;
      },
      error: () => (this.loadingFundNav = false),
    });
  }
  closeFund(): void {
    this.fund = null;
    this.fundInfo = null;
    this.fundNav = null;
  }

  useBasket(m: ModelBasket, goalId?: string): void {
    this.savingKey = m.key;
    const g = goalId ? this.goals.find((x) => x.id === goalId) ?? null : null;
    if (g) this.store.linkGoal(g);
    this.api
      .saveBasket({
        name: `${m.name} basket`,
        goal_id: g?.id ?? null,
        goal_label: g?.label ?? null,
        risk: m.risk,
        monthly_amount: g?.monthly_investment ?? null,
        items: m.items,
      })
      .subscribe({
        next: () => {
          this.savingKey = null;
          this.savedKey = m.key;
          this.saved.emit();
        },
        error: () => (this.savingKey = null),
      });
  }

  // fund search & compare
  onSearch(): void {
    this.search$.next(this.query.trim());
  }
  addCompare(f: DashboardFund): void {
    if (this.compare.length >= 4 || this.compare.some((x) => x.scheme_code === f.scheme_code)) return;
    this.compare = [...this.compare, f];
    this.query = '';
    this.results = [];
  }
  removeCompare(code: number): void {
    this.compare = this.compare.filter((x) => x.scheme_code !== code);
  }

  // basket compare (hidden panel)
  toggleBasketCompare(): void {
    this.showBasketCompare = !this.showBasketCompare;
    if (this.showBasketCompare && !this.basketCompareKeys.length) {
      this.basketCompareKeys = this.models.map((m) => m.key); // default: all 3
    }
  }
  toggleBasketInCompare(key: string): void {
    this.basketCompareKeys = this.basketCompareKeys.includes(key)
      ? this.basketCompareKeys.filter((k) => k !== key)
      : [...this.basketCompareKeys, key];
  }
  get comparedBaskets(): ModelBasket[] {
    return this.models.filter((m) => this.basketCompareKeys.includes(m.key));
  }

  // helpers
  fmt = inr;
  pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }
  plain(v: number | null | undefined, s = '%'): string {
    if (v === null || v === undefined) return '—';
    return `${v.toFixed(1)}${s}`;
  }
  sign(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  }
  retClass(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'muted';
    return v >= 0 ? 'pos' : 'neg';
  }
  ratingClass(n: number): string {
    if (n >= 4) return 'r-high';
    if (n === 3) return 'r-mid';
    return 'r-low';
  }
  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)', cash: '#94a3b8' }[a] ??
      'var(--accent)'
    );
  }
  allocSlices(m: ModelBasket) {
    return Object.entries(m.allocation).map(([k, v]) => ({ label: k, weight: v * 100, kind: k }));
  }
  stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  itemsOf(key: string): BasketItem[] {
    return this.models.find((m) => m.key === key)?.items ?? [];
  }
  modelOf(key: string): ModelBasket | undefined {
    return this.models.find((m) => m.key === key);
  }
}
