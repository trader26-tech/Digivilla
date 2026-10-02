import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdminService } from '../admin.service';
// The client's OWN engine — the preview is exactly what the app will compute.
import {
  CalcConfig, VillaFunds, simulatePayout, simulateSip, villaOf, villaRate, windowFor, withVilla,
} from '../../../../../client/frontend/src/app/calc/backtest.model';

const SERIES_LABEL: Record<string, string> = {
  arbitrage: 'Arbitrage', gold: 'Gold BeES', large: 'Nifty 50', mid: 'Midcap 150', small: 'Smallcap 250',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * CALCULATOR SETTINGS — edit the one object every calculator number comes from
 * (client/backend/app/calc_config.py). Edit → see the effect on every villa and
 * the calculators (the app's own engine, on the same history) → save & publish.
 * The app picks it up within a minute; every save keeps the version it replaced.
 */
@Component({
  selector: 'app-calc-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './calc-settings.component.html',
  styleUrls: ['./calc-settings.component.scss'],
})
export class CalcSettingsComponent implements OnInit {
  @Output() saved = new EventEmitter<CalcConfig>();
  private api = inject(AdminService);

  readonly SERIES_LABEL = SERIES_LABEL;
  readonly MONTHS = MONTHS;
  readonly series = signal<string[]>(['arbitrage', 'gold', 'large', 'mid', 'small']);
  readonly published = signal<CalcConfig | null>(null);
  readonly history = signal<any[]>([]);
  readonly loading = signal(true);
  readonly err = signal('');
  readonly saving = signal(false);
  readonly notice = signal('');
  readonly serverErrors = signal<string[]>([]);
  private vf: VillaFunds | null = null;
  readonly vfReady = signal(false);

  /** the draft being edited (plain object for ngModel); `tick` re-runs the preview */
  draft: CalcConfig | null = null;
  readonly tick = signal(0);
  touch(): void { this.tick.update((n) => n + 1); this.notice.set(''); this.validateSoon(); }

  ngOnInit(): void {
    this.api.calcConfig().subscribe({
      next: (r) => {
        this.published.set(r.config);
        this.history.set(r.history ?? []);
        if (r.series?.length) this.series.set(r.series);
        this.draft = structuredClone(r.config);
        this.loading.set(false);
        this.touch();
      },
      error: () => { this.err.set('Couldn’t load the settings.'); this.loading.set(false); },
    });
    this.api.auditVillaFunds().subscribe({ next: (vf) => { this.vf = vf; this.vfReady.set(true); }, error: () => {} });
  }

  // ── villas ──
  pct(v: any, s: string): number { return Math.round(((v.weights?.[s] ?? 0) * 100) * 1000) / 1000; }
  setPct(v: any, s: string, x: number): void {
    v.weights = { ...v.weights, [s]: Math.max(0, Math.min(100, +x || 0)) / 100 };
    if (!v.weights[s]) delete v.weights[s];
    this.touch();
  }
  sum(v: any): number { return Math.round(Object.values(v.weights ?? {}).reduce((a: number, b: any) => a + (+b || 0), 0) * 100000) / 1000; }
  addVilla(): void {
    if (!this.draft) return;
    const n = this.draft.villas.length + 1;
    this.draft.villas.push({ key: `villa${n}`, name: `Villa ${n}`, risk: 2, risk_name: 'Medium', weights: { arbitrage: 0.5, gold: 0.125, large: 0.125, mid: 0.125, small: 0.125 } });
    this.touch();
  }
  removeVilla(i: number): void {
    if (!this.draft || this.draft.villas.length <= 1) return;
    const k = this.draft.villas[i].key;
    this.draft.villas.splice(i, 1);
    if (this.draft.default_villa === k) this.draft.default_villa = this.draft.villas[0].key;
    this.touch();
  }
  moveVilla(i: number, d: number): void {
    if (!this.draft) return;
    const j = i + d;
    if (j < 0 || j >= this.draft.villas.length) return;
    const v = this.draft.villas;
    [v[i], v[j]] = [v[j], v[i]];
    this.touch();
  }
  riskName(v: any): void { v.risk_name = ({ 1: 'Low', 2: 'Medium', 3: 'High' } as any)[v.risk] ?? v.risk_name; this.touch(); }

  // ── lists of series (rebalance parts, pay first, gold parts) ──
  has(list: string[], s: string): boolean { return list.includes(s); }
  toggle(list: string[], s: string): void {
    const i = list.indexOf(s);
    if (i >= 0) list.splice(i, 1); else list.push(s);
    this.touch();
  }

  // ── % ↔ fraction fields ──
  getPct(obj: any, k: string): number { return Math.round((obj[k] ?? 0) * 100 * 10000) / 10000; }
  setPctField(obj: any, k: string, x: number): void { obj[k] = (+x || 0) / 100; this.touch(); }

  // ── validation: quick local checks now, the server's rules shortly after ──
  readonly localErrors = computed(() => {
    this.tick();
    const d = this.draft;
    if (!d) return [];
    const e: string[] = [];
    d.villas.forEach((v) => { const s = this.sum(v); if (Math.abs(s - 100) > 0.0001) e.push(`${v.name}: the mix adds up to ${s}% (needs 100%)`); });
    if (new Set(d.villas.map((v) => v.key)).size !== d.villas.length) e.push('Two villas share a key');
    return e;
  });
  private vT: ReturnType<typeof setTimeout> | undefined;
  private validateSoon(): void {
    clearTimeout(this.vT);
    this.vT = setTimeout(() => {
      if (!this.draft) return;
      this.api.calcConfigValidate(this.draft).subscribe({ next: (r) => this.serverErrors.set(r.errors ?? []), error: () => {} });
    }, 350);
  }
  /** the server's rules are the authority; the quick local check covers the gap while it answers */
  readonly errors = computed(() => (this.serverErrors().length ? this.serverErrors() : this.localErrors()));
  readonly dirty = computed(() => { this.tick(); return !!this.draft && JSON.stringify(strip(this.draft)) !== JSON.stringify(strip(this.published())); });

  // ── the preview: the app's own engine, published vs draft ──
  readonly preview = computed(() => {
    this.tick();
    const pub = this.published(), d = this.draft;
    if (!this.vfReady() || !this.vf || !pub || !d || this.localErrors().length) return null;
    const vf = this.vf;
    const keys = [...new Set([...pub.villas.map((v) => v.key), ...d.villas.map((v) => v.key)])];
    const safe = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };
    const rate = (c: CalcConfig, k: string) => (c.villas.some((v) => v.key === k) ? safe(() => villaRate(vf, c, k)) : null);
    const fd = (c: CalcConfig) => safe(() => {
      const w = windowFor(withVilla(vf, villaOf(c, c.default_villa)), 5);
      return simulatePayout(w, { amount: 1e7, fdRate: 6.5, slabPct: c.tax.default_slab, swp: c.withdrawals.swp_default }, c);
    });
    const sip = (c: CalcConfig) => safe(() => {
      const w = windowFor(withVilla(vf, villaOf(c, c.default_villa)), 10);
      return simulateSip(w, { monthly: 25000, stepPct: 10, slabPct: c.tax.default_slab, swp: c.withdrawals.swp_default }, c);
    });
    const a = fd(pub), b = fd(d), sa = sip(pub), sb = sip(d);
    return {
      villas: keys.map((k) => ({
        key: k, name: (d.villas.find((v) => v.key === k) ?? pub.villas.find((v) => v.key === k))!.name,
        was: rate(pub, k), now: rate(d, k),
      })),
      rows: [
        { label: `FD vs DigiVilla · ₹1 Cr · 5 yrs · default villa — DigiVilla total`, was: a?.dvTotal ?? null, now: b?.dvTotal ?? null, rupee: true },
        { label: 'Return a year (after tax)', was: a?.dvIrr ?? null, now: b?.dvIrr ?? null, rupee: false },
        { label: 'Monthly SWP on ₹1 Cr', was: a?.dvMonthly ?? null, now: b?.dvMonthly ?? null, rupee: true },
        { label: 'SIP ₹25,000/mo +10% · 10 yrs — worth today', was: sa?.value ?? null, now: sb?.value ?? null, rupee: true },
        { label: 'SIP — income received (after tax)', was: sa?.income ?? null, now: sb?.income ?? null, rupee: true },
      ],
    };
  });

  // ── save / discard / history ──
  discard(): void { this.draft = structuredClone(this.published()!); this.serverErrors.set([]); this.touch(); }
  save(): void {
    if (!this.draft || this.errors().length) return;
    if (!confirm('Publish these settings? Every calculator in the app will use them within a minute.')) return;
    this.saving.set(true);
    this.api.calcConfigSave(this.draft).subscribe({
      next: (r) => {
        this.published.set(r.config);
        this.history.set(r.history ?? []);
        this.draft = structuredClone(r.config);
        this.saving.set(false);
        this.notice.set(`Saved v${r.config.version} — live in the app within a minute.`);
        this.touch();
        this.saved.emit(r.config);
      },
      error: (e) => {
        this.saving.set(false);
        const d = e?.error?.detail;
        this.serverErrors.set(d?.errors ?? [typeof d === 'string' ? d : 'Save failed.']);
      },
    });
  }
  loadVersion(v: number): void {
    this.api.calcConfigVersion(v).subscribe({
      next: (r) => { this.draft = structuredClone(r.config); this.notice.set(`v${v} loaded into the editor — save to restore it.`); this.touch(); },
      error: () => this.notice.set(`Couldn’t load v${v}.`),
    });
  }

  // ── formatting ──
  inr(v: number | null): string { return v === null || !isFinite(v) ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'); }
  pctf(v: number | null): string { return v === null || !isFinite(v) ? '—' : v.toFixed(2) + '%'; }
  delta(was: number | null, now: number | null, rupee: boolean): string {
    if (was === null || now === null) return '';
    const d = now - was;
    if (Math.abs(d) < (rupee ? 0.5 : 0.005)) return 'same';
    return (d > 0 ? '+' : '−') + (rupee ? '₹' + Math.round(Math.abs(d)).toLocaleString('en-IN') : Math.abs(d).toFixed(2) + ' pts');
  }
}

/** compare settings without their stamps */
function strip(c: CalcConfig | null): any {
  if (!c) return null;
  const { version, updated_at, updated_by, ...rest } = c as any;
  return rest;
}
