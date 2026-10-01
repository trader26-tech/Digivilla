import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdminService, NetWorthRow } from '../admin.service';
// The client app's OWN calculator model — the exact code the app runs — so the
// page can put "what the app computes" next to the independent check.
import {
  VillaFunds, simulateFlat, simulatePayout, simulateSipIncome, windowFor,
} from '../../../../../client/frontend/src/app/calc/backtest.model';

type Tab = 'client' | 'navs' | 'calc';
type Kind = 'fd' | 'lump' | 'sip' | 'flat';

interface Row { label: string; app: number | null; check: number | null; pct?: boolean; }

/**
 * "Check the maths" — every number the client app shows, worked out step by step
 * so the admin can verify it:
 *  • Client: one client's funds (units × NAV), villas (pinned transactions × NAV)
 *    and a tie-out that the parts add up to the total the app shows.
 *  • NAVs: the NAV the app shows for every fund vs AMFI and mfapi.
 *  • Calculators: the app's own formula next to an independent recomputation,
 *    figure by figure, with the month-by-month ledger (CSV).
 */
@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.scss'],
})
export class AuditComponent implements OnInit {
  /** The admin's client list — the page picks the first real client once it arrives. */
  @Input() set clients(list: NetWorthRow[]) {
    this.clientList = list || [];
    if (!this.code() && this.clientList.length) {
      const first = this.clientList.find((c) => !c.demo) ?? this.clientList[0];
      this.pickClient(first.client_code);
    }
  }
  clientList: NetWorthRow[] = [];
  private api = inject(AdminService);

  readonly tab = signal<Tab>('client');

  // ── client ──
  readonly code = signal('');
  readonly client = signal<any>(null);
  readonly clientLoading = signal(false);
  readonly clientErr = signal('');
  readonly openVilla = signal<string | null>(null);

  // ── navs ──
  readonly navs = signal<any>(null);
  readonly navLoading = signal(false);

  // ── calculators ──
  readonly kind = signal<Kind>('fd');
  readonly years = signal(5);
  readonly amount = signal(10000000);
  readonly fdRate = signal(6.5);
  readonly slab = signal(30);
  readonly monthly = signal(25000);
  readonly step = signal(10);
  readonly price = signal(6000000);
  readonly value = signal(9000000);
  readonly rent = signal(20000);
  readonly calcLoading = signal(false);
  readonly calcErr = signal('');
  readonly check = signal<any>(null);
  readonly rows = signal<Row[]>([]);
  readonly showAll = signal(false);
  private vf: VillaFunds | null = null;

  readonly YEARS = [5, 8, 10, 15];
  readonly SLABS = [0, 5, 10, 15, 20, 25, 30];

  ngOnInit(): void { /* the client is picked when the list arrives (see `clients`) */ }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'navs' && !this.navs()) this.loadNavs();
  }

  // ── client ──
  pickClient(code: string): void {
    this.code.set(code);
    this.client.set(null);
    this.clientErr.set('');
    this.openVilla.set(null);
    if (!code) return;
    this.clientLoading.set(true);
    this.api.auditClient(code).subscribe({
      next: (r) => { this.client.set(r); this.clientLoading.set(false); },
      error: () => { this.clientErr.set('Couldn’t load this client.'); this.clientLoading.set(false); },
    });
  }
  allOk = computed(() => (this.client()?.checks ?? []).every((c: any) => c.ok));
  toggleVilla(id: string): void { this.openVilla.set(this.openVilla() === id ? null : id); }

  // ── navs ──
  loadNavs(): void {
    this.navLoading.set(true);
    this.api.auditNavs().subscribe({
      next: (r) => { this.navs.set(r); this.navLoading.set(false); },
      error: () => this.navLoading.set(false),
    });
  }
  navOk = computed(() => (this.navs()?.funds ?? []).filter((f: any) => f.match).length);

  // ── calculators ──
  run(): void {
    this.calcLoading.set(true);
    this.calcErr.set('');
    this.check.set(null);
    this.rows.set([]);
    this.showAll.set(false);
    const k = this.kind();
    const params: Record<string, string | number> = {
      kind: k, years: this.years(), slab: this.slab(), amount: this.amount(), fd_rate: this.fdRate(),
      monthly: this.monthly(), step: this.step(), price: this.price(), value: this.value(), rent: this.rent(), stamp: 7,
    };
    const go = (vf: VillaFunds) => {
      this.api.auditCalc(params).subscribe({
        next: (chk) => {
          this.check.set(chk);
          this.rows.set(this.compare(k, vf, chk.headline));
          this.calcLoading.set(false);
        },
        error: (e) => { this.calcErr.set(e?.error?.detail || 'The check failed.'); this.calcLoading.set(false); },
      });
    };
    if (this.vf) { go(this.vf); return; }
    this.api.auditVillaFunds().subscribe({
      next: (vf) => { this.vf = vf; go(vf); },
      error: (e) => { this.calcErr.set(e?.error?.detail || 'Couldn’t load fund history.'); this.calcLoading.set(false); },
    });
  }

  /** The app's own formula vs the independent check, figure by figure. */
  private compare(k: Kind, vf: VillaFunds, h: any): Row[] {
    const w = windowFor(vf, this.years());
    if (k === 'fd' || k === 'lump') {
      const r = simulatePayout(w, this.amount(), k === 'fd' ? this.fdRate() : 0, this.slab());
      const rows: Row[] = [
        { label: 'Payouts received (before tax)', app: r.dvPaidGross, check: h.dvPaidGross },
        { label: 'Tax on payouts', app: r.dvPayoutTax, check: h.dvPayoutTax },
        { label: 'Payouts after tax', app: r.dvPaid, check: h.dvPaid },
        { label: 'Still invested today', app: r.dvValue, check: h.dvValue },
        { label: 'Tax if sold today', app: r.dvExitTax, check: h.dvExitTax },
        { label: 'DigiVilla total (paid + invested)', app: r.dvTotal, check: h.dvTotal },
        { label: 'Arbitrage share today', app: r.arbNowPct, check: h.arbNowPct, pct: true },
        { label: 'Return a year (after tax)', app: r.dvIrr, check: h.dvIrr, pct: true },
      ];
      if (k === 'fd') rows.push(
        { label: 'FD interest after tax', app: r.fdPaid, check: h.fdPaid },
        { label: 'FD total', app: r.fdTotal, check: h.fdTotal },
      );
      return rows;
    }
    if (k === 'sip') {
      const r = simulateSipIncome(w, this.monthly(), this.step(), this.slab());
      return [
        { label: 'Put in', app: r.invested, check: h.invested },
        { label: 'Worth today (before tax)', app: r.value, check: h.value },
        { label: 'Tax if sold today', app: r.exitTax, check: h.exitTax },
        { label: 'Worth today after tax', app: r.valueAfterTax, check: h.valueAfterTax },
        { label: 'Income paid out (before tax)', app: r.incomeGross, check: h.incomeGross },
        { label: 'Tax on income', app: r.incomeTax, check: h.incomeTax },
        { label: 'Income after tax', app: r.income, check: h.income },
        { label: 'Return a year (XIRR)', app: r.xirr, check: h.xirr, pct: true },
      ];
    }
    const r = simulateFlat(w, { price: this.price(), value: this.value(), rent: this.rent(), stampPct: 7, slabPct: this.slab() });
    return [
      { label: 'All-in cost of the flat', app: r.outlay, check: h.outlay },
      { label: 'Flat price growth a year', app: r.appPct, check: h.appPct, pct: true },
      { label: 'Rent collected', app: r.rentGross, check: h.rentGross },
      { label: 'Tax on rent', app: r.rentTax, check: h.rentTax },
      { label: 'Upkeep', app: r.upkeep, check: h.upkeep },
      { label: 'Rent kept', app: r.rentKept, check: h.rentKept },
      { label: 'Flat total', app: r.flTotal, check: h.flTotal },
      { label: 'DigiVilla payouts after tax', app: r.dv.dvPaid, check: h.dvPaid },
      { label: 'DigiVilla still invested', app: r.dv.dvValue, check: h.dvValue },
      { label: 'DigiVilla total', app: r.dvTotal, check: h.dvTotal },
    ];
  }

  diff(r: Row): number | null {
    if (r.app === null || r.check === null) return null;
    const d = r.app - r.check;
    return Math.abs(d) < (r.pct ? 0.00005 : 0.005) ? 0 : d;     // no "−₹0.00" from float noise
  }
  /** Same to the rupee (₹1), or to 0.01 percentage point for rates. */
  same(r: Row): boolean {
    const d = this.diff(r);
    if (d === null) return r.app === r.check;
    return Math.abs(d) < (r.pct ? 0.01 : 1);
  }
  calcOk = computed(() => this.rows().length > 0 && this.rows().every((r) => this.same(r)));

  ledgerRows = computed(() => {
    const l = this.check()?.ledger ?? [];
    if (this.showAll() || l.length <= 14) return l;
    return [...l.slice(0, 7), null, ...l.slice(-6)];
  });
  ledgerCols = computed<string[]>(() => Object.keys(this.check()?.ledger?.[0] ?? {}));
  downloadCsv(): void {
    const l = this.check()?.ledger ?? [];
    if (!l.length) return;
    const cols = Object.keys(l[0]);
    const csv = [cols.join(','), ...l.map((r: any) => cols.map((c) => r[c]).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `digivilla-${this.kind()}-${this.years()}y-ledger.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── formatting ──
  inr(v: number | null | undefined, dp = 0): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v < 0 ? '−₹' : '₹') + s;
  }
  pct(v: number | null | undefined, dp = 2): string {
    return v === null || v === undefined || !isFinite(v) ? '—' : `${v.toFixed(dp)}%`;
  }
  fig(r: Row, v: number | null): string { return r.pct ? this.pct(v, 4) : this.inr(v, 2); }
  num(v: number | null | undefined, dp = 4): string {
    return v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: dp });
  }
  colLabel(c: string): string {
    return ({ month: 'Month', payout: 'Payout', sold_from: 'Sold from', arb_units: 'Arbitrage units', value: 'Value',
              tax_paid: 'Tax paid', put_in: 'Put in', invested_so_far: 'Put in so far' } as any)[c] || c;
  }
  cell(c: string, v: any): string {
    if (typeof v !== 'number') return v ?? '';
    if (c === 'arb_units') return this.num(v);
    return this.inr(v, 0);
  }
}
