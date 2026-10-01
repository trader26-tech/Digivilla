import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, computed, signal } from '@angular/core';

const PITCH = 10;                      // px between ticks — one tick is one step

/**
 * The amount control: ◀ [ LABEL / ₹1,00,00,000 ] ▶ over a ruler you drag like a
 * dial (the value under the green needle is the amount). Tap the amount to type
 * it; arrow keys / PageUp / PageDown / Home / End work on the ruler.
 */
@Component({
  selector: 'app-amount-dial',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './amount-dial.component.html',
  styleUrls: ['./amount-dial.component.scss'],
})
export class AmountDialComponent {
  @Input() label = 'You invest';
  @Input() set value(v: number) { this.v.set(v); }
  @Input() set min(v: number) { this.lo.set(v); }
  @Input() set max(v: number) { this.hi.set(v); }
  @Input() set step(v: number) { this.st.set(v); }
  @Input() nudgeBy = 5_00_000;
  @Input() major = 10_00_000;          // tall tick every …
  @Input() mid = 5_00_000;             // medium tick every …
  /** compact: steppers either side of the ruler, no amount box (the value shows elsewhere) */
  @Input() compact = false;
  /** how the value reads aloud / in the box (default ₹ with Indian grouping) */
  @Input() format: (v: number) => string = (v) => '₹' + v.toLocaleString('en-IN');
  @Output() valueChange = new EventEmitter<number>();
  @ViewChild('typed') typed?: ElementRef<HTMLInputElement>;

  readonly v = signal(0);
  readonly lo = signal(0);
  readonly hi = signal(1);
  readonly st = signal(1);
  readonly editing = signal(false);
  readonly dragging = signal(false);
  private drag: { x: number; start: number; id: number } | null = null;

  readonly ticks = computed(() => {
    const out: string[] = [];
    for (let x = this.lo(); x <= this.hi() + 1e-9; x += this.st()) out.push(x % this.major === 0 ? 'major' : x % this.mid === 0 ? 'mid' : 'minor');
    return out;
  });
  readonly x = computed(() => -((this.v() - this.lo()) / this.st()) * PITCH);
  readonly full = computed(() => this.format(this.v()));

  set(v: number): void {
    const s = this.st();
    const next = Math.min(this.hi(), Math.max(this.lo(), Math.round(v / s) * s));
    if (next === this.v()) return;
    this.v.set(next);
    this.valueChange.emit(next);
    if (next % this.major === 0) navigator.vibrate?.(6);
  }
  nudge(d: number): void { this.set(this.v() + d); }

  down(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, start: this.v(), id: e.pointerId };
    this.dragging.set(true);
  }
  move(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.set(this.drag.start + Math.round(-(e.clientX - this.drag.x) / PITCH) * this.st());
  }
  up(): void { this.drag = null; this.dragging.set(false); }
  key(e: KeyboardEvent): void {
    const s = this.st();
    const map: Record<string, number> = { ArrowRight: s, ArrowUp: s, ArrowLeft: -s, ArrowDown: -s, PageUp: 10 * s, PageDown: -10 * s };
    if (e.key === 'Home') this.set(this.lo());
    else if (e.key === 'End') this.set(this.hi());
    else if (map[e.key]) this.nudge(map[e.key]);
    else return;
    e.preventDefault();
  }

  startEdit(): void {
    this.editing.set(true);
    setTimeout(() => { const el = this.typed?.nativeElement; el?.focus(); el?.select(); });
  }
  onType(e: Event): void {
    const el = e.target as HTMLInputElement;
    const n = Number(el.value.replace(/[^\d]/g, '').slice(0, 10)) || 0;
    el.value = n ? n.toLocaleString('en-IN') : '';
  }
  commit(e: Event): void {
    if (!this.editing()) return;
    const n = Number((e.target as HTMLInputElement).value.replace(/[^\d]/g, '')) || 0;
    if (n) this.set(n);
    this.editing.set(false);
  }
}
