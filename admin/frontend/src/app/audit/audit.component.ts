import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdminService, NetWorthRow } from '../admin.service';
// The client app's OWN calculator model — the exact code the app runs — so the
// page can put "what the app computes" next to the independent check.
import {
  VillaFunds, simulateFlat, simulatePayout, simulateSipIncome, windowFor,
} from '../../../../../client/frontend/src/app/calc/backtest.model';

type Tab = 'client' | 'navs' | 'calc' | 'data';
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

  readonly YEARS = [5, 8, 10, 15];
  readonly SLABS = [0, 5, 10, 15, 20, 25, 30];

  ngOnInit(): void { /* the client is picked when the list arrives (see `clients`) */ }

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
    this.hoverI.set(null); this.hoverY.set(null);
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
        { label: '1 January rebalances', app: r.rebalances.length, check: h.rebalances, count: true },
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
        { label: '1 January rebalances', app: r.rebalances.length, check: h.rebalances, count: true },
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

  // ── the story: what the money did (charts) ──
  readonly SLEEVE_ORDER = ['arbitrage', 'mid', 'small', 'gold'];
  readonly COLORS: Record<string, string> = { arbitrage: '#7fb39b', mid: '#3f7d1f', small: '#8fd65a', gold: '#e0b23e' };
  story = computed<any>(() => this.check()?.story ?? null);
  storyOk = computed(() => (this.story()?.checks ?? []).every((c: any) => c.ok));
  growthSleeves = computed<any[]>(() => (this.story()?.sleeves ?? []).filter((s: any) => s.sleeve !== 'arbitrage'));
  growthWeights = computed(() => this.growthSleeves().map((g: any) => Math.round(g.weight * 100)).join(' : '));
  arbSleeve = computed<any>(() => (this.story()?.sleeves ?? []).find((s: any) => s.sleeve === 'arbitrage'));
  readonly hoverI = signal<number | null>(null);
  readonly hoverY = signal<number | null>(null);

  private readonly CW = 1000;          // chart viewBox width
  private readonly PL = 70; private readonly PR = 14;
  private xAt(i: number, n: number): number { return this.PL + (n ? i / n : 0) * (this.CW - this.PL - this.PR); }

  /** Stacked area: each sleeve's ₹ value every month, with the 1 January lines. */
  stack = computed(() => {
    const st = this.story();
    if (!st) return null;
    const months: string[] = st.series.months;
    const n = months.length - 1;
    const H = 300, T = 14, B = 30;
    const order = this.SLEEVE_ORDER.filter((s) => st.series.values[s]);
    const tot = months.map((_, i) => order.reduce((a, s) => a + st.series.values[s][i], 0));
    const max = this.niceMax(Math.max(...tot));
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const cum = months.map(() => 0);
    const bands = order.map((s) => {
      const lo = cum.slice();
      st.series.values[s].forEach((v: number, i: number) => (cum[i] += v));
      const top = months.map((_, i) => `${this.xAt(i, n).toFixed(1)},${y(cum[i]).toFixed(1)}`);
      const bot = months.map((_, i) => `${this.xAt(i, n).toFixed(1)},${y(lo[i]).toFixed(1)}`).reverse();
      return { sleeve: s, color: this.COLORS[s], d: `M${top.join('L')}L${bot.join('L')}Z` };
    });
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: y(max * f), label: this.short(max * f) }));
    const rb = (st.series.rebalance_months as string[]).map((m) => ({ x: this.xAt(months.indexOf(m), n), label: '1 Jan ’' + String(+m.slice(2, 4) + 1).padStart(2, '0') }));
    const step = n > 130 ? 2 : 1;
    const xl = months.map((m, i) => ({ m, i })).filter(({ m, i }) => m.endsWith('-01') && (+m.slice(0, 4)) % step === 0 && i > 2 && i < n - 2)
      .map(({ m, i }) => ({ x: this.xAt(i, n), label: m.slice(0, 4) }));
    return { H, T, B, n, months, bands, ticks, rb, xl, tot, order, bottom: H - B };
  });

  /** One line per fund (₹ value), same x scale — the clearest view of each fund
   *  shrinking (payouts) or stepping (1 January). */
  readonly chartMode = signal<'lines' | 'stack'>('lines');
  lines = computed(() => {
    const st = this.story();
    if (!st) return null;
    const months: string[] = st.series.months;
    const n = months.length - 1;
    const H = 300, T = 14, B = 30;
    const order = this.SLEEVE_ORDER.filter((s) => st.series.values[s]);
    const max = this.niceMax(Math.max(...order.flatMap((s) => st.series.values[s])));
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const rbIdx = (st.series.rebalance_months as string[]).map((m) => months.indexOf(m));
    const ls = order.map((s) => {
      const v: number[] = st.series.values[s];
      return {
        sleeve: s, color: this.COLORS[s],
        d: 'M' + v.map((x, i) => `${this.xAt(i, n).toFixed(1)},${y(x).toFixed(1)}`).join('L'),
        dots: rbIdx.map((i) => ({ x: this.xAt(i, n), y: y(v[i]) })),
        end: { x: this.xAt(n, n), y: y(v[n]), label: this.short(v[n]) },
      };
    });
    // keep the end labels from overlapping
    const ends = ls.map((l) => l.end).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: y(max * f), label: this.short(max * f) }));
    return { H, B, ls, ticks, bottom: H - B };
  });

  /** Arbitrage units, month by month — only payouts take them down. */
  arb = computed(() => {
    const st = this.story();
    if (!st) return null;
    const months: string[] = st.series.months;
    const u: number[] = st.series.arb_units;
    const n = months.length - 1;
    const H = 170, T = 14, B = 26;
    const max = Math.max(...u) * 1.08 || 1;
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const pts = u.map((v, i) => `${this.xAt(i, n).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `M${this.xAt(0, n)},${H - B}L${pts.join('L')}L${this.xAt(n, n)},${H - B}Z`;
    const marks = (st.series.rebalance_months as string[]).map((m) => {
      const i = months.indexOf(m);
      return { x: this.xAt(i, n), y: y(u[i]), m };
    });
    return { H, B, line: `M${pts.join('L')}`, area, marks, first: u[0], last: u[n], yFirst: Math.min(y(u[0]), H - B - 22), yLast: Math.min(y(u[n]), H - B - 22) };
  });

  /** Per 1 January: each index's return since the last one, and what was moved. */
  yearsChart = computed(() => {
    const st = this.story();
    if (!st?.years?.length) return null;
    const ys: any[] = st.years;
    const H = 230, T = 18, B = 26, mid = 0;
    const plotW = this.CW - this.PL - this.PR;
    const gw = plotW / ys.length;
    const bw = Math.min(16, (gw - 10) / 4);
    // returns
    const rets = ys.flatMap((y) => y.funds.map((f: any) => f.index_ret));
    const rMax = this.niceMax(Math.max(5, ...rets)), rMin = -this.niceMax(Math.max(5, ...rets.map((v: number) => -v)));
    const ry = (v: number) => T + (rMax - v) / (rMax - rMin) * (H - T - B);
    // moved
    const mv = ys.flatMap((y) => y.funds.map((f: any) => f.moved));
    const mAbs = this.niceMax(Math.max(1, ...mv.map((v: number) => Math.abs(v))));
    const my = (v: number) => T + (mAbs - v) / (2 * mAbs) * (H - T - B);
    const groups = ys.map((y, gi) => {
      const x0 = this.PL + gi * gw + (gw - bw * 4 - 6) / 2;
      const bars = this.SLEEVE_ORDER.map((s, k) => {
        const f = y.funds.find((ff: any) => ff.sleeve === s);
        if (!f) return null;
        const x = x0 + k * (bw + 2);
        const r = { x, w: bw, y: Math.min(ry(f.index_ret), ry(0)), h: Math.max(1, Math.abs(ry(f.index_ret) - ry(0))), color: this.COLORS[s] };
        const m = { x, w: bw, y: Math.min(my(f.moved), my(0)), h: Math.abs(my(f.moved) - my(0)), color: this.COLORS[s], zero: s === 'arbitrage' };
        return { sleeve: s, r, m };
      }).filter(Boolean);
      return { gi, label: this.growthYear(y, true), cx: this.PL + gi * gw + gw / 2, x: this.PL + gi * gw, w: gw, bars };
    });
    const rt = this.spaced([0, rMax, rMin, rMax / 2, rMin / 2].map((v) => ({ y: ry(v), label: `${v > 0 ? '+' : ''}${Math.round(v)}%` })));
    const mt = [0, mAbs, -mAbs, mAbs / 2, -mAbs / 2].map((v) => ({ y: my(v), label: (v > 0 ? '+' : v < 0 ? '−' : '') + this.short(Math.abs(v)) }));
    return { H, B, groups, rt, mt, r0: ry(0), m0: my(0) };
  });
  hoverYear = computed(() => { const i = this.hoverY(); return i === null ? null : this.story()?.years?.[i] ?? null; });

  onStackMove(ev: MouseEvent, svg: Element): void {
    const c = this.stack();
    if (!c) return;
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * this.CW;
    const i = Math.round(((x - this.PL) / (this.CW - this.PL - this.PR)) * c.n);
    this.hoverI.set(i < 0 || i > c.n ? null : i);
  }
  hoverX = computed(() => { const c = this.stack(), i = this.hoverI(); return c && i !== null ? this.xAt(i, c.n) : 0; });
  hoverPct = computed(() => (this.hoverX() / this.CW) * 100);
  hoverRow = computed(() => {
    const st = this.story(), i = this.hoverI();
    if (!st || i === null) return null;
    const m = st.series.months[i];
    const vals = this.SLEEVE_ORDER.filter((s) => st.series.values[s]).map((s) => ({ s, v: st.series.values[s][i] })).reverse();
    return { m, vals, total: vals.reduce((a, b) => a + b.v, 0), units: st.series.arb_units[i], rb: (st.series.rebalance_months as string[]).includes(m) };
  });
  /** The calendar year whose growth a 1 January rebalance corrects ('2016', or '’16*' when it's a part year). */
  growthYear(y: any, short = false): string {
    const yr = y.month.slice(0, 4);
    const part = !(y.since.endsWith('-12') && +y.since.slice(0, 4) === +yr - 1);
    return (short ? '’' + yr.slice(2) : yr) + (part ? '*' : '');
  }
  partNote = computed(() => {
    const y = this.story()?.years?.[0];
    return y && this.growthYear(y).endsWith('*') ? `* ${y.month.slice(0, 4)} from ${this.monthName(y.since)} only` : '';
  });
  monthName(m: string): string { return new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleString('en-IN', { month: 'short' }); }
  // ── month by month, per fund ──
  monthlyRows = computed<any[]>(() => {
    const m = this.story()?.monthly ?? [];
    if (this.showAll() || m.length <= 16) return m;
    return [...m.slice(0, 8), null, ...m.slice(-6)];
  });
  monthlyCount = computed(() => this.story()?.monthly?.length ?? 0);
  /** One plain sentence for what happened that month. */
  happened(r: any, first: boolean): string {
    const f = r.f, names = this.SLEEVE_ORDER.filter((s) => f[s]);
    const parts: string[] = [];
    const inv = names.reduce((a, s) => a + f[s].inv, 0);
    if (inv > 0.5) parts.push(first && this.kind() !== 'sip' ? `Invested ${this.short(inv)} in today’s split` : `${this.kind() === 'sip' ? 'SIP' : 'Put in'} ${this.short(inv)}`);
    const paid = names.filter((s) => f[s].paid > 0.5);
    if (paid.length) parts.push(`Paid you ${this.short(paid.reduce((a, s) => a + f[s].paid, 0))} — sold from ${paid.map((s) => this.sleeveLabel(s).toLowerCase()).join(' + ')}`);
    if (r.rebalanced) {
      const sold = names.filter((s) => f[s].rb < -0.5).map((s) => `${this.sleeveLabel(s).toLowerCase()} −${this.short(-f[s].rb)}`);
      const bought = names.filter((s) => f[s].rb > 0.5).map((s) => `${this.sleeveLabel(s).toLowerCase()} +${this.short(f[s].rb)}`);
      parts.push(`↻ 1 Jan ${this.nextYear(r.month)} rebalance: sold ${sold.join(', ') || '—'} → bought ${bought.join(', ') || '—'}; arbitrage untouched`);
    }
    if (r.tax_paid > 0.5) parts.push(`Tax for the year paid: ${this.inr(r.tax_paid)}`);
    return parts.join(' · ') || 'Market move only';
  }
  downloadMonthly(): void {
    const m = this.story()?.monthly ?? [];
    if (!m.length) return;
    const names = this.SLEEVE_ORDER.filter((s) => m[0].f[s]);
    const head = ['month', ...names.flatMap((s) => [`${s}_value`, `${s}_put_in`, `${s}_sold_to_pay_you`, `${s}_rebalance_bought(+)/sold(-)`, `${s}_market_move`]),
                  'total_value', 'payout', 'tax_paid', 'rebalanced', 'what_happened'];
    const rows = m.map((r: any, i: number) => [r.month, ...names.flatMap((s) => [r.f[s].v, r.f[s].inv, r.f[s].paid, r.f[s].rb, r.f[s].mkt]),
                  r.total, r.payout, r.tax_paid, r.rebalanced ? 'yes' : '', `"${this.happened(r, i === 0).replace(/"/g, "'")}"`].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `digivilla-${this.kind()}-${this.years()}y-month-by-month.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

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

  yearFund(y: any, s: string): any { return y?.funds?.find((f: any) => f.sleeve === s); }

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
