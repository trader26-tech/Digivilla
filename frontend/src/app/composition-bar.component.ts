import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CompositionSlice } from './models';

/** A labelled stacked bar for asset composition / cap tilt. */
@Component({
  selector: 'app-composition-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="comp">
      <div class="bar">
        <span
          *ngFor="let s of slices"
          [style.width.%]="s.weight"
          [style.background]="color(s.kind)"
          [title]="s.label + ' ' + s.weight + '%'"
        ></span>
      </div>
      <div class="legend">
        <span class="lg" *ngFor="let s of slices">
          <i [style.background]="color(s.kind)"></i>{{ s.label }} {{ s.weight }}%
        </span>
      </div>
    </div>
  `,
  styles: [
    `
      .bar {
        display: flex;
        height: 12px;
        border-radius: 6px;
        overflow: hidden;
        background: var(--surface-2);
      }
      .bar span {
        height: 100%;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 0.9rem;
        margin-top: 0.5rem;
      }
      .lg {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.76rem;
        color: var(--muted);
      }
      .lg i {
        width: 9px;
        height: 9px;
        border-radius: 2px;
      }
    `,
  ],
})
export class CompositionBarComponent {
  @Input() slices: CompositionSlice[] = [];

  color(kind: string): string {
    return (
      { equity: 'var(--eq)', debt: 'var(--dt)', gold: 'var(--gd)', cash: '#94a3b8' }[kind] ??
      'var(--accent)'
    );
  }
}
