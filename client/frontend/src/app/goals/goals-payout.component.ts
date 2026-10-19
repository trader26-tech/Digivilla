import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, OnInit, Output, ViewChild, computed, effect, inject, signal } from '@angular/core';

import { GoalsService, Payout, VillaCategory } from './goals.service';

/** Monthly Payout (design "Monthly Payout"): today's payout on a tuning dial —
 *  turn it to a target, see what to invest once, buy, and read the payout
 *  history. Owned villas = finished villas on the account (the ring's TODAY). */
interface Tick { x1: string; y1: string; x2: string; y2: string; w: number; c: string; }
interface Label { t: string; a: number; y: number; c: string; }
interface HistRow { yr: string; day: number; mon: string; month: string; n: number; amt: string; }
const SHEET_CLASS = 'tv-sheet-open';   // the shell hides its floating tab bar (this page has its own CTA)
const STEP = 6, MAX = 50, C = [170, 175] as const;
const pt = (deg: number, r: number): [number, number] => { const t = (deg - 90) * Math.PI / 180; return [C[0] + Math.cos(t) * r, C[1] + Math.sin(t) * r]; };
const CAT_NAME: Record<VillaCategory, string> = { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive' };

@Component({
  selector: 'app-goals-payout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goals-payout.component.html',
  styleUrls: ['./goals-shared.scss', './goals-payout.component.scss'],
})
export class GoalsPayoutComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly goals = inject(GoalsService);
  @Output() back = new EventEmitter<void>();

  readonly MAX = MAX;
  @ViewChild('ctaEl') ctaEl?: ElementRef<HTMLElement>;
  @ViewChild('toastEl') toastEl?: ElementRef<HTMLElement>;
  @ViewChild('confirmEl') confirmEl?: ElementRef<HTMLDialogElement>;
  @ViewChild('histEl') histEl?: ElementRef<HTMLDialogElement>;
  readonly ready = computed(() => !!this.goals.data());

  // ── dial state ──
  readonly rot = signal(0);
  readonly drag = signal(false);
  readonly hist = signal(false);
  readonly confirm = signal(false);
  readonly toast = signal('');
  readonly err = signal('');
  readonly busy = signal(false);
  /** the centre amount, rolled (odometer) towards the target */
  readonly disp = signal<number | null>(null);

  readonly own = computed(() => this.goals.owned());
  readonly mo = computed(() => this.goals.perVillaMonth());
  readonly maxRot = computed(() => Math.max(0, (MAX - this.own()) * STEP));
  readonly rotC = computed(() => Math.max(0, Math.min(this.maxRot(), this.rot())));
  readonly villas = computed(() => this.own() + Math.round(this.rotC() / STEP));
  readonly buy = computed(() => this.villas() - this.own());
  readonly target = computed(() => this.villas() * this.mo());
  readonly ringTr = computed(() => this.drag() ? 'none' : 'transform .35s cubic-bezier(.2,.9,.25,1)');

  /** 60 knurl ticks, one per villa, 6° apart; majors every 5 villas; green once passed */
  readonly knurl = computed<Tick[]>(() => {
    const own = this.own(), buy = this.buy(), range = MAX - own;
    return Array.from({ length: 60 }, (_, k) => {
      const a = -k * STEP, inR = k <= range, major = (own + k) % 5 === 0, passed = k <= buy && inR;
      const [x1, y1] = pt(a, major ? 138 : 143), [x2, y2] = pt(a, 152);
      return { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), w: major ? 2.4 : 1.3,
        c: !inR ? 'rgba(255,255,255,.08)' : passed ? (k === 0 ? '#fbdb81' : '#8fd65a') : major ? 'rgba(251,219,129,.7)' : 'rgba(225,224,204,.35)' };
    });
  });
  /** the green gain arc from TODAY to the current position */
  readonly gainD = computed(() => {
    const buy = this.buy(); if (!buy) return '';
    const [gx0, gy0] = pt(-buy * STEP, 130), [gx1, gy1] = pt(0, 130);
    return 'M' + gx0.toFixed(1) + ' ' + gy0.toFixed(1) + ' A130 130 0 ' + (buy * STEP > 180 ? 1 : 0) + ' 1 ' + gx1.toFixed(1) + ' ' + gy1.toFixed(1);
  });
  /** labels printed on the ring: TODAY, then every 5 villas */
  readonly labels = computed<Label[]>(() => {
    if (!this.ready()) return [];
    const own = this.own(), villas = this.villas(), mo = this.mo(), out: Label[] = [];
    for (let v = own; v <= MAX; v++) if (v === own || v % 5 === 0) {
      const k = v - own; if (v !== own && k < 4) continue;   // too close to TODAY to read
      out.push({ t: v === own ? 'TODAY' : '₹' + (+(v * mo / 1000).toFixed(1)) + 'k', a: -k * STEP, y: 175 - 118, c: v === own ? '#fbdb81' : v <= villas ? '#cfe9bb' : 'rgba(225,224,204,.8)' });
    }
    return out;
  });

  // ── copy ──
  readonly dispTxt = computed(() => this.goals.inr(Math.round((this.disp() ?? this.target()) / 100) * 100));
  readonly curTxt = computed(() => this.goals.inr(this.own() * this.mo()));
  readonly gainTxt = computed(() => this.goals.inr(this.buy() * this.mo()));
  readonly newTxt = computed(() => this.goals.inr(this.target()));
  readonly costV = computed(() => this.buy() ? this.goals.lakh(this.buy() * this.goals.villaCost()) : '₹0');
  readonly hint = computed(() => {
    const t = this.target(), buy = this.buy();
    const ms = t >= 45000 ? 'Like a second salary' : t >= 25000 ? 'Covers rent in a big city' : t >= 15000 ? 'Covers the monthly bills' : '';
    return buy ? (ms || 'Turn for more') : 'Turn the dial clockwise';
  });
  readonly resK = computed(() => this.buy() ? 'Invest once' : 'Turn the dial to see what to invest');
  readonly newVillas = computed(() => Array.from({ length: Math.min(this.buy(), 8) }, (_, i) => i));
  readonly resL = computed(() => {
    const buy = this.buy(), own = this.own();
    if (buy) return (buy > 8 ? '+' + (buy - 8) + ' · ' : '') + buy + ' new villa' + (buy > 1 ? 's' : '');
    return 'You own ' + own + (own === 1 ? ' villa' : ' villas');
  });
  readonly ctaTxt = computed(() => this.buy() ? 'Invest ' + this.goals.lakh(this.buy() * this.goals.villaCost()) : 'Turn the dial to grow');
  readonly decOn = computed(() => this.buy() > 0);
  readonly incOn = computed(() => this.ready() && this.villas() < MAX);

  /** the category to buy: the one the client holds most of (balanced when none) */
  readonly category = computed<VillaCategory>(() => {
    const t = this.goals.data()?.by_type; if (!t) return 'balanced';
    const best = (Object.keys(t) as VillaCategory[]).reduce((a, b) => (t[b] > t[a] ? b : a), 'balanced' as VillaCategory);
    return t[best] > 0 ? best : 'balanced';
  });
  readonly catName = computed(() => CAT_NAME[this.category()]);
  readonly villaL = computed(() => this.goals.lakhShort(this.goals.villaCost()));
  /** the first extra payout: the payday after next */
  readonly firstNew = computed(() => {
    const n = this.goals.nextPayday();
    return new Date(n.getFullYear(), n.getMonth() + 1, this.goals.payday()).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  });

  // ── history (real payouts received) ──
  readonly recvTxt = computed(() => this.goals.inr(this.goals.data()?.received ?? 0));
  readonly count = computed(() => this.goals.data()?.payout_count ?? 0);
  readonly countTxt = computed(() => this.count() + (this.count() === 1 ? ' payout' : ' payouts'));
  readonly payDayTxt = computed(() => { const p = this.goals.payday(); return p + (p === 1 ? 'st' : p === 2 ? 'nd' : p === 3 ? 'rd' : 'th'); });
  readonly history = computed<HistRow[]>(() => {
    const rows = [...(this.goals.data()?.payouts ?? [])].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
    let prevY = '';
    return rows.map((p: Payout) => {
      const [y, m] = p.month.split('-').map(Number), d = new Date(y, (m || 1) - 1, 1);
      const day = p.date ? new Date(p.date + 'T12:00:00').getDate() : this.goals.payday();
      const yr = String(y) !== prevY ? String(y) : ''; prevY = String(y);
      return { yr, day, mon: d.toLocaleString('en-IN', { month: 'short' }).toUpperCase(), month: d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }), n: p.villas, amt: this.goals.inr(p.amount) };
    });
  });

  private raf = 0; private tt: ReturnType<typeof setTimeout> | null = null;
  private pad: HTMLElement | null = null; private a0 = 0;

  constructor() {
    // the centre amount rolls to each new target (first paint: no roll)
    effect(() => {
      const to = this.target();
      if (!this.ready()) return;
      if (this.disp() == null) { this.disp.set(to); return; }
      this.tween(to);
    }, { allowSignalWrites: true });
  }
  ngOnInit(): void { document.body.classList.add(SHEET_CLASS); }
  ngAfterViewInit(): void { this.pop(this.ctaEl, true); }
  ngOnDestroy(): void {
    document.body.classList.remove(SHEET_CLASS); cancelAnimationFrame(this.raf); if (this.tt) clearTimeout(this.tt);
    this.pop(this.ctaEl, false); this.pop(this.toastEl, false); this.modal(this.confirmEl, false); this.modal(this.histEl, false);
  }
  /* the sheets, the toast and the CTA live in the top layer (<dialog> / popover): the
     shell's tab host is animated with a transform, which would pin position:fixed to it */
  private modal(ref: ElementRef<HTMLDialogElement> | undefined, on: boolean): void {
    const d = ref?.nativeElement; if (!d) return;
    try { if (on && !d.open) d.showModal(); else if (!on && d.open) d.close(); } catch { if (on) d.setAttribute('open', ''); else d.removeAttribute('open'); }
  }
  private pop(ref: ElementRef<HTMLElement> | undefined, on: boolean): void {
    const e = ref?.nativeElement as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void; matches: (s: string) => boolean }) | undefined; if (!e) return;
    try { const open = e.matches(':popover-open'); if (on && !open) e.showPopover?.(); else if (!on && open) e.hidePopover?.(); } catch { /* no popover API: the fixed fallback */ }
  }

  private tween(to: number): void {
    cancelAnimationFrame(this.raf);
    const from = this.disp() ?? to, t0 = performance.now();
    if (from === to) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.disp.set(to); return; }
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 320), e = 1 - Math.pow(1 - k, 3);
      this.disp.set(from + (to - from) * e);
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  // ── the dial ──
  private ang(e: PointerEvent): number {
    const r = (this.pad as HTMLElement).getBoundingClientRect();
    return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
  }
  onDown(e: PointerEvent): void {
    if (!this.ready()) return;
    this.pad = e.currentTarget as HTMLElement;
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* older WebKit */ }
    this.a0 = this.ang(e); this.drag.set(true);
  }
  onMove(e: PointerEvent): void {
    if (!this.drag() || !this.pad) return;
    const a = this.ang(e); let d = a - this.a0; if (d > 180) d -= 360; if (d < -180) d += 360; this.a0 = a;
    const prevV = Math.round(this.rot() / STEP), r = Math.max(0, Math.min(this.maxRot(), this.rot() + d)), nv = Math.round(r / STEP);
    if (nv !== prevV) this.tick();
    this.rot.set(r);
  }
  onUp(): void { if (this.drag()) { this.drag.set(false); this.rot.set(Math.round(this.rot() / STEP) * STEP); } }
  private setV(v: number): void { this.rot.set((Math.max(this.own(), Math.min(MAX, v)) - this.own()) * STEP); this.tick(); }
  dec(): void { if (this.decOn()) this.setV(this.villas() - 1); }
  inc(): void { if (this.incOn()) this.setV(this.villas() + 1); }
  private tick(): void { try { if (navigator.vibrate) navigator.vibrate(4); } catch { /* not on this device */ } }

  // ── buy ──
  openConfirm(): void { if (this.buy()) { this.err.set(''); this.confirm.set(true); this.modal(this.confirmEl, true); } }
  closeConfirm(): void { if (this.busy()) return; this.confirm.set(false); this.modal(this.confirmEl, false); }
  pay(): void {
    const n = this.buy(); if (!n || this.busy()) return;
    this.busy.set(true); this.err.set('');
    const newMonthly = this.goals.inr(this.target());
    this.goals.requestVillas(n, this.category(), `Monthly payout goal: ${newMonthly} a month`).subscribe({
      next: () => {
        this.busy.set(false); this.closeConfirm(); this.rot.set(0);
        this.toast.set(`Done · ${newMonthly} a month once placed`); this.pop(this.toastEl, true);
        if (this.tt) clearTimeout(this.tt); this.tt = setTimeout(() => { this.toast.set(''); this.pop(this.toastEl, false); }, 2800);
      },
      error: () => { this.busy.set(false); this.err.set('That did not go through. Please try again.'); },
    });
  }
  openHist(): void { this.hist.set(true); this.modal(this.histEl, true); }
  closeHist(): void { this.hist.set(false); this.modal(this.histEl, false); }
}
