import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnDestroy, ViewChild, computed, effect, signal, untracked } from '@angular/core';

import { fmtInr } from './backtest.model';
import { VillaPickComponent } from './villa-pick.component';

export interface Seg3d {
  label: string;
  val: number;
  bg: string;       // front face
  side: string;     // matching side-face colour
  top?: string;     // top-face colour (used for the first segment)
  k: string;        // label colour
  c: string;        // value colour
  short?: string;   // one word for the breakdown under a short column (default: first word of label)
}
export interface Col3d {
  art: string;      // assets/calc/<art>.svg
  coin?: boolean;   // a coin bobbing above the art
  green?: boolean;  // DigiVilla styling (green total, glow)
  pick?: boolean;   // the villa picker (SWP · villa · ← →) instead of plain art
  segs: Seg3d[];    // top → bottom
}

const PAD_X = 18, COL_GAP = 30, PAD_BOTTOM = 22;
const ABOVE_BAR = 36, TOTAL_LINE = 26;
/** a segment needs this much height to show its label + value, or just its value */
const FULL_LABEL = 34, VALUE_ONLY = 17;

/** Width of a total at the chart's font, for the arrow's end points. */
let ctx: CanvasRenderingContext2D | null = null;
function textW(s: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return s.length * 11.5;
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  return ctx.measureText(s).width;
}

/**
 * Two isometric 3D columns on a grid floor, each made of stacked segments with
 * its art and total above, and a glowing arrow from the left total to the right.
 * Heights are TRUE TO SCALE (the taller column fills the chart; the other is
 * its real fraction of that), so the gap between the two is the real gap. A
 * segment too thin for its label shows just its value, or nothing — and then the
 * column's breakdown is written under it instead. Totals count to new values.
 */
@Component({
  selector: 'app-bars-3d',
  standalone: true,
  imports: [CommonModule, VillaPickComponent],
  templateUrl: './bars-3d.component.html',
  styleUrls: ['./bars-3d.component.scss'],
})
export class Bars3dComponent implements OnDestroy {
  @Input({ required: true }) set left(c: Col3d) { this.l.set(c); }
  @Input({ required: true }) set right(c: Col3d) { this.r.set(c); }
  /** draw the arrow from the left total to the right one (e.g. only when the right one wins) */
  @Input() showArrow = true;
  /** until the user taps "Show me": flat columns, hidden totals — then they rise */
  @Input() set veiled(v: boolean) { if (this.veil() && !v) this.revealing.set(true); this.veil.set(v); }
  readonly veil = signal(false);
  /** the first rise after a reveal (slower, staggered) */
  readonly revealing = signal(false);
  readonly l = signal<Col3d | null>(null);
  readonly r = signal<Col3d | null>(null);

  private readonly W = signal(350);
  private readonly H = signal(342);
  private readonly short = matchMedia('(max-height: 760px)').matches;
  private ro?: ResizeObserver;
  /** false until the first layout has settled and the columns have risen. Until then the
   *  FD → DigiVilla arrow is hidden; then it draws in once (`entering`), and after that it
   *  follows changes smoothly. (While veiled the arrow stays off; the reveal has its own draw.) */
  readonly settled = signal(false);
  readonly entering = signal(false);
  private settleTimer?: ReturnType<typeof setTimeout>;

  @ViewChild('chart') set chartEl(ref: ElementRef<HTMLElement> | undefined) {
    this.ro?.disconnect();
    const el = ref?.nativeElement;
    if (!el) return;
    const measure = () => {
      if (Math.abs(el.clientWidth - this.W()) > 1) this.W.set(el.clientWidth);
      if (Math.abs(el.clientHeight - this.H()) > 1) this.H.set(el.clientHeight);
    };
    measure();
    this.ro = new ResizeObserver(measure);
    this.ro.observe(el);
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settled.set(true);
      this.entering.set(true);
      this.settleTimer = setTimeout(() => this.entering.set(false), 800);
    }, 700);
  }

  private total = (c: Col3d | null) => (c ? c.segs.reduce((s, x) => s + x.val, 0) : 0);
  readonly lTotal = computed(() => this.total(this.l()));
  readonly rTotal = computed(() => this.total(this.r()));

  private build(c: Col3d | null, scale: number) {
    if (!c) return null;
    const segs = c.segs.filter((s) => s.val > 0.5);
    const total = segs.reduce((s, d) => s + d.val, 0);
    // true to scale — never padded to fit a label — with a 10px floor so it still reads as a block
    const k = total * scale < 10 && total > 0 ? 10 / total : scale;
    const hs = segs.map((d) => (this.veil() ? 0 : Math.max(2, Math.round(d.val * k))));
    let acc = 0;
    const stops = segs.map((d, i) => { const a = acc; acc += hs[i]; return `${d.side} ${a}px ${acc}px`; }).join(',');
    const out = segs.map((d, i) => ({
      ...d, h: hs[i], value: fmtInr(d.val),
      mode: hs[i] >= FULL_LABEL ? 'full' : hs[i] >= VALUE_ONLY ? 'value' : 'none',
    }));
    // any segment that can't name itself → spell the column out underneath
    const brk = !this.veil() && out.some((s) => s.mode !== 'full')
      ? out.map((s) => `${s.value} ${(s.short ?? s.label.split(' ')[0]).toLowerCase()}`).join(' + ')
      : '';
    return {
      art: c.art, coin: !!c.coin, green: !!c.green, pick: !!c.pick,
      segs: out, brk,
      h: acc, side: `linear-gradient(180deg,${stops})`, top: segs[0]?.top ?? segs[0]?.bg ?? '#444',
    };
  }
  readonly cols = computed(() => {
    const pick = !!(this.l()?.pick || this.r()?.pick);
    const maxBar = Math.max(90, this.H() - (this.short ? 172 : 200) - (pick ? (this.short ? 16 : 24) : 0));
    const scale = maxBar / Math.max(this.lTotal(), this.rTotal(), 1);
    return { l: this.build(this.l(), scale), r: this.build(this.r(), scale) };
  });

  /** An arc from just right of the left total to just left of the right one. */
  readonly arrow = computed(() => {
    const W = this.W(), H = this.H(), c = this.cols();
    const cw = (W - PAD_X * 2 - COL_GAP) / 2;
    const c1 = PAD_X + cw / 2, c2 = PAD_X + cw + COL_GAP + cw / 2, mid = W / 2;
    const yOf = (h: number) => H - PAD_BOTTOM - h - ABOVE_BAR - TOTAL_LINE / 2;
    const x0 = Math.min(c1 + textW(fmtInr(this.lTotal())) / 2 + 12, mid - 22);
    const x1 = Math.max(c2 - textW(fmtInr(this.rTotal())) / 2 - 12, mid + 22);
    const y0 = yOf(c.l?.h ?? 0), y1 = yOf(c.r?.h ?? 0);
    const cy = Math.min(y0, y1) - 30;
    return { d: `M${x0.toFixed(1)} ${y0.toFixed(1)} Q${((x0 + x1) / 2).toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`, W, H, x0, x1 };
  });

  // totals count from where they were to the new value (~450ms, ease-out)
  readonly lShown = signal(0);
  readonly rShown = signal(0);
  private raf = 0;
  readonly fmt = fmtInr;

  constructor() {
    effect(() => {
      const lt = this.lTotal(), rt = this.rTotal(), veiled = this.veil();
      const first = untracked(this.revealing);
      const l0 = untracked(this.lShown), r0 = untracked(this.rShown);
      cancelAnimationFrame(this.raf);
      if (veiled) { this.lShown.set(0); this.rShown.set(0); return; }
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || (!l0 && !first)) { this.lShown.set(lt); this.rShown.set(rt); this.revealing.set(false); return; }
      const t0 = performance.now(), dur = first ? 1100 : 450;
      if (first) setTimeout(() => this.revealing.set(false), 1500);
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        this.lShown.set(l0 + (lt - l0) * e);
        this.rShown.set(r0 + (rt - r0) * e);
        if (p < 1) this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void { this.ro?.disconnect(); cancelAnimationFrame(this.raf); clearTimeout(this.settleTimer); }
}
