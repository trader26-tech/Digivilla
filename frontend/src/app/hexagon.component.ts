import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

export interface HexAxis {
  key: string;
  label: string;
  hint: string;
}

/**
 * Interactive 6-axis hexagon. Each vertex is a preference (0..100) the user
 * drags in/out. Emits the values so the parent can derive a basket live.
 */
@Component({
  selector: 'app-hexagon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hexagon.component.html',
  styleUrl: './hexagon.component.scss',
})
export class HexagonComponent {
  @Input() axes: HexAxis[] = [];
  @Input() values: Record<string, number> = {};
  @Input() showSliders = true;
  @Output() valuesChange = new EventEmitter<Record<string, number>>();
  @Output() changed = new EventEmitter<Record<string, number>>();

  @ViewChild('svg', { static: true }) svgRef!: ElementRef<SVGSVGElement>;

  readonly size = 320;
  readonly cx = 160;
  readonly cy = 160;
  readonly rMax = 120;
  readonly rings = [0.25, 0.5, 0.75, 1];

  private dragging: number | null = null;

  // angle for vertex i (start at top, clockwise)
  angle(i: number): number {
    return -Math.PI / 2 + (i * 2 * Math.PI) / 6;
  }

  point(i: number, r: number): { x: number; y: number } {
    const a = this.angle(i);
    return { x: this.cx + r * Math.cos(a), y: this.cy + r * Math.sin(a) };
  }

  vertex(i: number): { x: number; y: number } {
    const v = this.values[this.axes[i].key] ?? 50;
    return this.point(i, (v / 100) * this.rMax);
  }

  labelPos(i: number): { x: number; y: number } {
    return this.point(i, this.rMax + 26);
  }

  ringPath(scale: number): string {
    return (
      this.axes
        .map((_, i) => {
          const p = this.point(i, this.rMax * scale);
          return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        })
        .join(' ') + ' Z'
    );
  }

  spoke(i: number): { x1: number; y1: number; x2: number; y2: number } {
    const p = this.point(i, this.rMax);
    return { x1: this.cx, y1: this.cy, x2: p.x, y2: p.y };
  }

  get shapePath(): string {
    return (
      this.axes
        .map((_, i) => {
          const p = this.vertex(i);
          return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        })
        .join(' ') + ' Z'
    );
  }

  startDrag(i: number, ev: Event): void {
    ev.preventDefault();
    this.dragging = i;
  }

  onMove(ev: MouseEvent | TouchEvent): void {
    if (this.dragging === null) return;
    const svg = this.svgRef.nativeElement;
    const rect = svg.getBoundingClientRect();
    const pt = 'touches' in ev ? ev.touches[0] : ev;
    // map client coords into the 320x320 viewBox
    const x = ((pt.clientX - rect.left) / rect.width) * this.size;
    const y = ((pt.clientY - rect.top) / rect.height) * this.size;
    const a = this.angle(this.dragging);
    // project onto this axis direction
    const proj = (x - this.cx) * Math.cos(a) + (y - this.cy) * Math.sin(a);
    let v = Math.round((proj / this.rMax) * 100);
    v = Math.max(0, Math.min(100, v));
    const key = this.axes[this.dragging].key;
    const next = { ...this.values, [key]: v };
    this.values = next;
    this.valuesChange.emit(next);
  }

  endDrag(): void {
    if (this.dragging !== null) {
      this.dragging = null;
      this.changed.emit(this.values);
    }
  }

  setValue(key: string, val: string): void {
    const v = Math.max(0, Math.min(100, Number(val)));
    const next = { ...this.values, [key]: v };
    this.values = next;
    this.valuesChange.emit(next);
    this.changed.emit(next);
  }

  valOf(key: string): number {
    return this.values[key] ?? 50;
  }
}
