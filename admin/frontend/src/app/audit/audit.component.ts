import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdminService, NetWorthRow } from '../admin.service';
import { CalcSettingsComponent } from './calc-settings.component';
// The client app's OWN calculator model — the exact code the app runs — so the
// page can put "what the app computes" next to the independent check.
import {
  CalcConfig, DEFAULT_CONFIG, VillaFunds, simulateFlat, simulatePayout, simulateSip, villaOf, windowFor, withVilla,
} from '../../../../../client/frontend/src/app/calc/backtest.model';

type Tab = 'client' | 'navs' | 'calc' | 'data' | 'settings';
type Kind = 'fd' | 'lump' | 'sip' | 'flat';

interface Row { label: string; app: number | null; check: number | null; pct?: boolean; count?: boolean; }

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
  imports: [CommonModule, FormsModule, CalcSettingsComponent],
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

  readonly tab = signal<Tab>('calc');

  // ── data used ──
  readonly data = signal<any>(null);
  readonly dataLoading = signal(false);
  readonly dataErr = signal('');
  readonly dataYear = signal<string>('all');

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
  /** the settings in force (from the admin API) — the same object the app uses */
  readonly cfg = signal<CalcConfig>(DEFAULT_CONFIG);
  readonly villa = signal<string>(DEFAULT_CONFIG.default_villa);
  readonly swp = signal(true);
  readonly villas = computed(() => this.cfg().villas);
  pickVilla(v: string): void { if (this.villa() !== v) { this.villa.set(v); this.run(); } }
  private cfgLoaded = false;
  /** the settings arrived (or were just saved on the Settings tab) */
  applySettings(r: { config: CalcConfig }): void {
    this.cfg.set(r.config);
    this.cfgLoaded = true;
    if (!r.config.villas.some((v) => v.key === this.villa())) this.villa.set(r.config.default_villa);
  }
  onSettingsSaved(cfg: CalcConfig): void { this.applySettings({ config: cfg }); this.check.set(null); }
  toggleSwp(): void { this.swp.set(!this.swp()); this.run(); }
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
  readonly openReb = signal<string | null>(null);
  toggleReb(m: string): void { this.openReb.set(this.openReb() === m ? null : m); }
  private vf: VillaFunds | null = null;
  /** The app's own year-by-year numbers (exactly what its year columns show). */
  readonly appYearly = signal<any[]>([]);

  readonly YEARS = [5, 8, 10, 15];
  readonly SLABS = [0, 5, 10, 15, 20, 25, 30];

  /** Calculators is the first tab: run the default check straight away. */
  ngOnInit(): void { this.run(); }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'navs' && !this.navs()) this.loadNavs();
    if (t === 'data' && !this.data()) this.loadData();
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

  // ── data used ──
  loadData(): void {
    this.dataLoading.set(true);
    this.dataErr.set('');
    this.api.auditData().subscribe({
      next: (r) => { this.data.set(r); this.dataLoading.set(false); },
      error: (e) => { this.dataErr.set(e?.error?.detail || 'Couldn’t load the data.'); this.dataLoading.set(false); },
    });
  }
  dataYears = computed<string[]>(() => [...new Set<string>((this.data()?.rows ?? []).map((r: any) => r.month.slice(0, 4)))].reverse());
  dataRows = computed<any[]>(() => {
    const rows = this.data()?.rows ?? [];
    const y = this.dataYear();
    return (y === 'all' ? rows : rows.filter((r: any) => r.month.startsWith(y))).slice().reverse();
  });
  /** month-on-month change of one series, for the table */
  mom(row: any, sleeve: string): number | null {
    const rows = this.data()?.rows ?? [];
    const i = rows.findIndex((r: any) => r.month === row.month);
    return i > 0 ? (row[sleeve] / rows[i - 1][sleeve] - 1) * 100 : null;
  }
  downloadData(): void {
    const d = this.data();
    if (!d) return;
    const cols = ['month', ...d.series.map((s: any) => s.sleeve)];
    const head = ['month', ...d.series.map((s: any) => `"${s.name}"`)].join(',');
    const csv = [head, ...d.rows.map((r: any) => cols.map((c) => r[c]).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `digivilla-calculator-index-data-${d.start}-to-${d.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  /** '2021-12' → 2022: the 1 January the 31-Dec close stands for */
  nextYear(m: string): number { return Number(m.slice(0, 4)) + 1; }
  sleeveLabel(s: string): string {
    return ({ arbitrage: 'Arbitrage', mid: 'Mid cap', small: 'Small cap', gold: 'Gold', large: 'Large cap' } as any)[s] || s;
  }

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
  pickKind(k: Kind): void { if (this.kind() === k && this.check()) return; this.kind.set(k); this.run(); }
  run(): void {
    this.calcLoading.set(true);
    this.calcErr.set('');
    this.check.set(null);
    this.rows.set([]);
    this.showAll.set(false);
    this.openYear.set(null);
    const k = this.kind();
    const params: Record<string, string | number> = {
      kind: k, years: this.years(), slab: this.slab(), amount: this.amount(), fd_rate: this.fdRate(),
      monthly: this.monthly(), step: this.step(), price: this.price(), value: this.value(), rent: this.rent(), stamp: 7,
      villa: this.villa(), swp: String(this.swp()),
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
    const withData = () => {
      if (this.vf) { go(this.vf); return; }
      this.api.auditVillaFunds().subscribe({
        next: (vf) => { this.vf = vf; go(vf); },
        error: (e) => { this.calcErr.set(e?.error?.detail || 'Couldn’t load fund history.'); this.calcLoading.set(false); },
      });
    };
    if (this.cfgLoaded) { withData(); return; }
    this.api.calcConfig().subscribe({
      next: (r) => { this.applySettings(r); withData(); },
      error: (e) => { this.calcErr.set(e?.error?.detail || 'Couldn’t load the calculator settings.'); this.calcLoading.set(false); },
    });
  }

  /** The app's own formula vs the independent check, figure by figure. */
  private compare(k: Kind, vf: VillaFunds, h: any): Row[] {
    const cfg = this.cfg();
    const w = windowFor(withVilla(vf, villaOf(cfg, this.villa())), this.years());
    const swp = this.swp();
    if (k === 'fd' || k === 'lump') {
      const r = simulatePayout(w, { amount: this.amount(), fdRate: k === 'fd' ? this.fdRate() : 0, slabPct: this.slab(), swp }, cfg);
      this.appYearly.set(r.yearly);
      const rows: Row[] = [
        { label: 'Payouts received (before tax)', app: r.dvPaidGross, check: h.dvPaidGross },
        { label: 'Tax on payouts', app: r.dvPayoutTax, check: h.dvPayoutTax },
        { label: 'Payouts after tax', app: r.dvPaid, check: h.dvPaid },
        { label: 'Tax on the 1 January rebalances', app: r.dvRebalanceTax, check: h.dvRebalanceTax },
        { label: 'Still invested today', app: r.dvValue, check: h.dvValue },
        { label: 'DigiVilla total (paid + invested)', app: r.dvTotal, check: h.dvTotal },
        { label: 'Arbitrage share today', app: r.arbNowPct, check: h.arbNowPct, pct: true },
        { label: 'Return a year (after tax)', app: r.dvIrr, check: h.dvIrr, pct: true },
        { label: '1 January rebalances', app: r.rebalances.length, check: h.rebalances, count: true },
      ];
      if (k === 'fd') rows.push(
        { label: 'FD interest after tax', app: r.fdPaid, check: h.fdPaid },
        { label: 'FD total', app: r.fdTotal, check: h.fdTotal },
      );
      return rows;
    }
    if (k === 'sip') {
      const r = simulateSip(w, { monthly: this.monthly(), stepPct: this.step(), slabPct: this.slab(), swp }, cfg);
      this.appYearly.set(r.yearly);
      return [
        { label: 'Put in', app: r.invested, check: h.invested },
        { label: 'Worth today', app: r.value, check: h.value },
        { label: 'Tax on the 1 January rebalances', app: r.rebalanceTax, check: h.rebalanceTax },
        { label: 'Income paid out (before tax)', app: r.incomeGross, check: h.incomeGross },
        { label: 'Tax on income', app: r.incomeTax, check: h.incomeTax },
        { label: 'Income after tax', app: r.income, check: h.income },
        { label: 'Return a year (XIRR)', app: r.xirr, check: h.xirr, pct: true },
        { label: '1 January rebalances', app: r.rebalances.length, check: h.rebalances, count: true },
      ];
    }
    const r = simulateFlat(w, { price: this.price(), value: this.value(), rent: this.rent(), slabPct: this.slab(), swp }, cfg);
    this.appYearly.set(r.dv.yearly);
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

  // ── charts (Data used) ──
  readonly SLEEVE_ORDER = ['arbitrage', 'mid', 'small', 'gold'];
  readonly COLORS: Record<string, string> = { arbitrage: '#7fb39b', mid: '#3f7d1f', small: '#8fd65a', gold: '#e0b23e' };

  private readonly CW = 1000;          // chart viewBox width
  private readonly PL = 70; private readonly PR = 14;
  private xAt(i: number, n: number): number { return this.PL + (n ? i / n : 0) * (this.CW - this.PL - this.PR); }

  // ── year by year: the app's screen vs the independent simulation ──
  /** app value vs check value → one cell */
  private pair(app: number | undefined, check: number | undefined) {
    const ok = app !== undefined && check !== undefined && Math.abs(app - check) < 1;
    return { app: app ?? null, check: check ?? null, ok };
  }
  yearRows = computed<any[]>(() => {
    const k = this.check(), app = this.appYearly();
    if (!k?.yearly) return [];
    return k.yearly.map((c: any, i: number) => {
      const a = app[i] ?? {};
      return {
        year: c.year, month: c.month, funds: c.funds, arbUnits: c.arb_units,
        paidYear: c.payout,
        worth: this.pair(a.value, c.value),
        before: this.pair(a.value, c.value),
        income: c.income !== undefined ? this.pair(a.income, c.income) : null,
        invested: c.invested !== undefined ? this.pair(a.invested, c.invested) : null,
        perMonth: c.invested !== undefined ? this.pair(a.payout !== undefined ? a.payout / 12 : undefined, c.payout / 12) : null,
        payout: this.pair(a.payout, c.payout),
        both: (a.value ?? 0) + (a.income ?? 0),
      };
    });
  });
  yearsAllOk = computed(() => this.yearRows().length > 0 && this.yearRows().every((r) =>
    r.worth.ok && r.before.ok && r.payout.ok && (!r.income || r.income.ok) && (!r.invested || r.invested.ok)));
  rowOk(r: any): boolean { return r.worth.ok && r.before.ok && r.payout.ok && (!r.income || r.income.ok) && (!r.invested || r.invested.ok); }
  isSip = computed(() => this.kind() === 'sip');
  startAmount = computed(() => this.kind() === 'flat' ? (this.check()?.headline?.outlay ?? 0) : this.amount());

  // ── click a year: every month of it, worked out ──
  readonly openYear = signal<number | null>(null);
  toggleYear(y: number): void { this.openYear.set(this.openYear() === y ? null : y); this.simHover.set(null); }

  // ── one graph: every month of the simulation ──
  readonly simHover = signal<number | null>(null);      // index into simChart().bars
  simChart = computed(() => {
    const d: any[] = this.check()?.detail ?? [];
    if (!d.length) return null;
    const y = this.openYear();
    const months = y === null ? d : d.filter((m) => (y === 1 ? m.i >= 0 : m.i > 12 * (y - 1)) && m.i <= 12 * y);
    const H = 300, T = 16, B = 46;
    const plotW = this.CW - this.PL - this.PR;
    const slot = plotW / months.length;
    const bw = Math.max(1.5, Math.min(44, slot * 0.74));
    const max = this.niceMax(Math.max(...months.map((m) => m.total_close)));
    const yv = (v: number) => T + (1 - v / max) * (H - T - B);
    const base = H - B;
    const order = this.SLEEVE_ORDER;
    const bars = months.map((m, j) => {
      let cum = 0;
      const segs = order.map((s) => {
        const f = m.funds.find((x: any) => x.sleeve === s);
        const v = f?.value_close ?? 0;
        const seg = { s, y: yv(cum + v), h: Math.max(0, yv(cum) - yv(cum + v)), color: this.COLORS[s] };
        cum += v;
        return seg;
      });
      const ev: any[] = m.events ?? [];
      return {
        j, i: m.i, month: m.month, x: this.PL + j * slot + (slot - bw) / 2, cx: this.PL + j * slot + slot / 2, w: bw, segs,
        top: yv(m.total_close), year: m.i === 0 ? 1 : Math.ceil(m.i / 12),
        rb: ev.some((e) => e.op === 'rebalance'), tax: !!m.fy_tax, start: m.i === 0,
      };
    });
    // year bands (whole-run view) or month labels (one year)
    const bands = y !== null ? [] : [...new Set(bars.map((b) => b.year))].map((yr) => {
      const bs = bars.filter((b) => b.year === yr);
      const x0 = this.PL + bs[0].j * slot, x1 = this.PL + (bs[bs.length - 1].j + 1) * slot;
      return { yr, x: x0, w: x1 - x0, cx: (x0 + x1) / 2 };
    });
    const labels = y === null ? [] : bars.map((b) => ({ x: b.cx, label: this.monthName(b.month) + (b.month.endsWith('-01') || b.j === 0 ? ' ’' + b.month.slice(2, 4) : '') }));
    const ticks = this.spaced([0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: yv(max * f), label: this.short(max * f) })));
    return { H, B, base, bars, bands, labels, ticks, slot, year: y };
  });
  yearOf(i: number): number { return i === 0 ? 1 : Math.ceil(i / 12); }
  simPick(b: any): void { if (this.openYear() === null) this.toggleYear(b.year); }
  onSimMove(ev: MouseEvent, svg: Element): void {
    const c = this.simChart();
    if (!c) return;
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * this.CW;
    const j = Math.floor((x - this.PL) / c.slot);
    this.simHover.set(j < 0 || j >= c.bars.length ? null : j);
  }
  /** Everything about the hovered month, for the tooltip under the graph. */
  simHoverMonth = computed(() => {
    const c = this.simChart(), j = this.simHover();
    if (!c || j === null) return null;
    const d: any[] = this.check()?.detail ?? [];
    const m = d.find((x) => x.i === c.bars[j].i);
    return m ? { ...this.monthSteps(m), x: c.bars[j].cx } : null;
  });
  monthName(m: string): string { return new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleString('en-IN', { month: 'short' }); }
  /** the months of year y (year 1 also shows the start month) */
  yearMonths = computed<any[]>(() => {
    const y = this.openYear(), d: any[] = this.check()?.detail ?? [];
    if (y === null || !d.length) return [];
    return d.filter((m) => (y === 1 ? m.i >= 0 : m.i > 12 * (y - 1)) && m.i <= 12 * y).map((m) => this.monthSteps(m));
  });
  /** Turn one month's operations into the steps the page writes out. */
  private monthSteps(m: any): any {
    const ev: any[] = m.events ?? [];
    const by = (s: string) => m.funds.find((f: any) => f.sleeve === s);
    const invest = ev.filter((e) => e.op === 'buy' && e.tag === 'invest');
    const payIdx = ev.findIndex((e) => e.op === 'pay');
    const pay = payIdx >= 0 ? { ...ev[payIdx], sells: ev.filter((e) => e.op === 'sell' && e.tag === 'payout') } : null;
    const rbIdx = ev.findIndex((e) => e.op === 'rebalance');
    const rebal = rbIdx >= 0 ? { ...ev[rbIdx],
      sells: ev.filter((e) => e.op === 'sell' && e.tag === 'rebalance'), buys: ev.filter((e) => e.op === 'buy' && e.tag === 'rebalance') } : null;
    const gain = (xs: any[]) => xs.reduce((a, e) => a + (e.gain_st ?? 0) + (e.gain_lt ?? 0), 0);
    return {
      ...m, label: m.i === 0 ? 'Start' : `Month ${m.i}`,
      funds: m.funds.map((f: any) => ({ ...f, chg: f.nav_prev ? (f.nav / f.nav_prev - 1) * 100 : null })),
      invest: invest.length ? { total: invest.reduce((a, e) => a + e.rupees, 0), rows: invest } : null,
      pay, payGain: pay ? gain(pay.sells) : 0, payTax: ev.find((e) => e.op === 'pay_tax') ?? null,
      rebal, rebalGain: rebal ? gain(rebal.sells) : 0,
      arbNav: by('arbitrage')?.nav,
    };
  }
  fyOf(m: string): string { const y = +m.slice(0, 4), mo = +m.slice(5, 7), s = mo >= 4 ? y : y - 1; return `FY ${s}-${String(s + 1).slice(2)}`; }
  u(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
  ix(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }

  // ── data used: charts ──
  /** Growth of ₹100 put into each index at the start, month by month. */
  dataGrowth = computed(() => {
    const d = this.data();
    if (!d?.rows?.length) return null;
    const rows: any[] = d.rows, n = rows.length - 1;
    const order = this.SLEEVE_ORDER.filter((s) => rows[0][s] !== undefined);
    const vals = Object.fromEntries(order.map((s) => [s, rows.map((r) => (r[s] / rows[0][s]) * 100)]));
    const H = 320, T = 14, B = 30;
    const max = this.niceMax(Math.max(...order.flatMap((s) => vals[s])));
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const ls = order.map((s) => ({
      sleeve: s, color: this.COLORS[s],
      d: 'M' + vals[s].map((v: number, i: number) => `${this.xAt(i, n).toFixed(1)},${y(v).toFixed(1)}`).join('L'),
      end: { x: this.xAt(n, n), y: y(vals[s][n]), label: '₹' + Math.round(vals[s][n]) },
    }));
    const ends = ls.map((l) => l.end).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: y(max * f), label: '₹' + Math.round(max * f) }));
    const xl = rows.map((r, i) => ({ m: r.month, i })).filter(({ m, i }) => m.endsWith('-01') && (+m.slice(0, 4)) % 2 === 0 && i > 2 && i < n - 2)
      .map(({ m, i }) => ({ x: this.xAt(i, n), label: m.slice(0, 4) }));
    const decs = rows.map((r, i) => ({ m: r.month, i })).filter(({ m, i }) => m.endsWith('-12') && i > 0).map(({ i }) => this.xAt(i, n));
    return { H, B, n, ls, ticks, xl, decs, vals, order, bottom: H - B };
  });
  readonly dataHover = signal<number | null>(null);
  onDataMove(ev: MouseEvent, svg: Element): void {
    const c = this.dataGrowth();
    if (!c) return;
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * this.CW;
    const i = Math.round(((x - this.PL) / (this.CW - this.PL - this.PR)) * c.n);
    this.dataHover.set(i < 0 || i > c.n ? null : i);
  }
  dataHoverX = computed(() => { const c = this.dataGrowth(), i = this.dataHover(); return c && i !== null ? this.xAt(i, c.n) : 0; });
  dataHoverRow = computed(() => {
    const c = this.dataGrowth(), i = this.dataHover(), d = this.data();
    if (!c || i === null || !d) return null;
    return { m: d.rows[i].month, vals: c.order.map((s: string) => ({ s, g: c.vals[s][i], idx: d.rows[i][s] })) };
  });
  /** Each calendar year's return per index (Dec → Dec; the first year is partial). */
  dataYearsChart = computed(() => {
    const d = this.data();
    if (!d?.rows?.length) return null;
    const rows: any[] = d.rows;
    const order = this.SLEEVE_ORDER.filter((s) => rows[0][s] !== undefined);
    const yearsList: { y: string; part: boolean; from: any; to: any }[] = [];
    let from = rows[0];
    rows.forEach((r, i) => {
      if (r.month.endsWith('-12') || i === rows.length - 1) {
        if (r !== from) yearsList.push({ y: r.month.slice(0, 4), part: !from.month.endsWith('-12') || !r.month.endsWith('-12'), from, to: r });
        from = r;
      }
    });
    const ys = yearsList.map((y) => ({ ...y, ret: Object.fromEntries(order.map((s) => [s, (y.to[s] / y.from[s] - 1) * 100])) }));
    const H = 260, T = 18, B = 26;
    const all = ys.flatMap((y) => order.map((s) => y.ret[s]));
    const rMax = this.niceMax(Math.max(5, ...all)), rMin = -this.niceMax(Math.max(5, ...all.map((v) => -v)));
    const ry = (v: number) => T + (rMax - v) / (rMax - rMin) * (H - T - B);
    const plotW = this.CW - this.PL - this.PR, gw = plotW / ys.length, bw = Math.min(14, (gw - 8) / order.length);
    const groups = ys.map((y, gi) => {
      const x0 = this.PL + gi * gw + (gw - (bw + 2) * order.length) / 2;
      return { gi, y, label: '’' + y.y.slice(2) + (y.part ? '*' : ''), cx: this.PL + gi * gw + gw / 2, x: this.PL + gi * gw, w: gw,
        bars: order.map((s, k) => ({ s, x: x0 + k * (bw + 2), w: bw, y: Math.min(ry(y.ret[s]), ry(0)), h: Math.max(1, Math.abs(ry(y.ret[s]) - ry(0))), color: this.COLORS[s] })) };
    });
    const rt = this.spaced([0, rMax, rMin, rMax / 2, rMin / 2].map((v) => ({ y: ry(v), label: `${v > 0 ? '+' : ''}${Math.round(v)}%` })));
    return { H, B, groups, rt, r0: ry(0), order, ys };
  });
  readonly dataYearHover = signal<number | null>(null);

  /** keep axis ticks at least 16 units apart (no "−3%" on top of "0%") */
  private spaced<T extends { y: number }>(ticks: T[]): T[] {
    const out: T[] = [];
    for (const t of ticks) if (out.every((o) => Math.abs(o.y - t.y) >= 16)) out.push(t);
    return out;
  }
  private niceMax(v: number): number {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * p;
  }
  /** ₹ in Cr / L, short */
  short(v: number): string {
    const a = Math.abs(v), sg = v < 0 ? '−' : '';
    if (a >= 1e7) return `${sg}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)} Cr`;
    if (a >= 1e5) return `${sg}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
    if (a >= 1e3) return `${sg}₹${(a / 1e3).toFixed(0)}k`;
    return `${sg}₹${Math.round(a)}`;
  }
  signed(v: number): string { return Math.abs(v) < 0.5 ? '₹0' : (v > 0 ? '+' : '') + this.short(v); }

  // ── formatting ──
  inr(v: number | null | undefined, dp = 0): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v < 0 ? '−₹' : '₹') + s;
  }
  pct(v: number | null | undefined, dp = 2): string {
    return v === null || v === undefined || !isFinite(v) ? '—' : `${v.toFixed(dp)}%`;
  }
  fig(r: Row, v: number | null): string { return r.count ? String(v ?? '—') : r.pct ? this.pct(v, 4) : this.inr(v, 2); }
  num(v: number | null | undefined, dp = 4): string {
    return v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: dp });
  }
  colLabel(c: string): string {
    return ({ month: 'Month', payout: 'Payout', sold_from: 'Sold from', arb_units: 'Arbitrage units', value: 'Value', rebalanced: '1 Jan rebalance',
              tax_paid: 'Tax paid', put_in: 'Put in', invested_so_far: 'Put in so far' } as any)[c] || c;
  }
  cell(c: string, v: any): string {
    if (c === 'rebalanced') return v ? '↻ rebalanced' : '';
    if (typeof v !== 'number') return v ?? '';
    if (c === 'arb_units') return this.num(v);
    return this.inr(v, 0);
  }
}
