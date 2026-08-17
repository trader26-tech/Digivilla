import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { FundService } from './fund.service';
import { Facets, Stats } from './fund.models';

@Component({
  selector: 'app-fund-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './fund-dashboard.component.html',
  styleUrl: './fund-dashboard.component.scss',
})
export class FundDashboardComponent implements OnInit {
  private readonly funds = inject(FundService);
  private readonly router = inject(Router);

  readonly stats = signal<Stats | null>(null);
  readonly facets = signal<Facets>({ fund_houses: [], categories: [] });

  ngOnInit(): void {
    this.funds.stats().subscribe((s) => this.stats.set(s));
    this.funds.facets().subscribe((f) => this.facets.set(f));
  }

  browseCategory(category: string): void {
    void this.router.navigate(['/funds'], { queryParams: { category } });
  }
}
