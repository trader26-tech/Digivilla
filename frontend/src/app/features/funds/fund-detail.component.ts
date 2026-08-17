import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { NavChartComponent } from './nav-chart.component';
import { FundService } from './fund.service';
import { NavPoint, SchemeDetail } from './fund.models';

@Component({
  selector: 'app-fund-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, NavChartComponent],
  templateUrl: './fund-detail.component.html',
  styleUrl: './fund-detail.component.scss',
})
export class FundDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly funds = inject(FundService);

  readonly scheme = signal<SchemeDetail | null>(null);
  readonly nav = signal<NavPoint[]>([]);
  readonly loading = signal(true);
  readonly chartLoading = signal(false);
  readonly range = signal<'1y' | '3y' | '5y' | 'all'>('1y');
  readonly ranges: Array<'1y' | '3y' | '5y' | 'all'> = ['1y', '3y', '5y', 'all'];

  private code = 0;

  ngOnInit(): void {
    this.code = Number(this.route.snapshot.paramMap.get('code'));
    this.funds.detail(this.code).subscribe({
      next: (d) => {
        this.scheme.set(d);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.loadNav();
  }

  setRange(r: '1y' | '3y' | '5y' | 'all'): void {
    this.range.set(r);
    this.loadNav();
  }

  private loadNav(): void {
    this.chartLoading.set(true);
    this.funds.navHistory(this.code, this.range()).subscribe({
      next: (points) => {
        this.nav.set(points);
        this.chartLoading.set(false);
      },
      error: () => this.chartLoading.set(false),
    });
  }

  cls(value: number | null | undefined): string {
    if (value == null) return '';
    return value >= 0 ? 'pos' : 'neg';
  }

  fmt(value: number | null | undefined, suffix = '%'): string {
    if (value == null) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}${suffix}`;
  }
}
