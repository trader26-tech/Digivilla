import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { FundService } from './fund.service';
import { Facets, SchemeSummary } from './fund.models';

@Component({
  selector: 'app-fund-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fund-explorer.component.html',
  styleUrl: './fund-explorer.component.scss',
})
export class FundExplorerComponent implements OnInit {
  private readonly funds = inject(FundService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly search$ = new Subject<string>();

  readonly items = signal<SchemeSummary[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly facets = signal<Facets>({ fund_houses: [], categories: [] });

  q = '';
  fundHouse = '';
  category = '';
  plan = '';
  sort = 'name';
  readonly limit = 24;
  offset = 0;

  ngOnInit(): void {
    this.funds.facets().subscribe((f) => this.facets.set(f));
    this.search$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.offset = 0;
        this.load();
      });
    // Honor ?category= from the dashboard's category chips.
    const cat = this.route.snapshot.queryParamMap.get('category');
    if (cat) {
      this.category = cat;
    }
    this.load();
  }

  onSearch(): void {
    this.search$.next(this.q);
  }

  onFilter(): void {
    this.offset = 0;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.funds
      .list({
        q: this.q,
        fund_house: this.fundHouse,
        category: this.category,
        plan: this.plan,
        sort: this.sort,
        limit: this.limit,
        offset: this.offset,
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  open(code: number): void {
    void this.router.navigate(['/funds', code]);
  }

  nextPage(): void {
    if (this.offset + this.limit < this.total()) {
      this.offset += this.limit;
      this.load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  prevPage(): void {
    if (this.offset > 0) {
      this.offset = Math.max(0, this.offset - this.limit);
      this.load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  get pageInfo(): string {
    if (this.total() === 0) return '0 results';
    const from = this.offset + 1;
    const to = Math.min(this.offset + this.limit, this.total());
    return `${from}–${to} of ${this.total().toLocaleString()}`;
  }

  clearFilters(): void {
    this.q = '';
    this.fundHouse = '';
    this.category = '';
    this.plan = '';
    this.sort = 'name';
    this.offset = 0;
    this.load();
  }
}
