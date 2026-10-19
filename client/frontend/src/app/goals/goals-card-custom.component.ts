import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';

import { CustomGoal, GoalsService } from './goals.service';

/** The lavender "Your own goal" card (design "Custom Goal Card") — and, given a
 *  saved goal, the same card language showing that goal (name, amount, villas,
 *  kind) with a small × to remove it. */
interface Chip { t: string; c: string; x: string; y: string; r: string; d: string; }
const KIND_ICON: Record<string, string> = { wedding: 'Wedding', education: 'Education', car: 'Car', medical: 'Medical', home: 'Home', other: 'Goal' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

@Component({
  selector: 'app-goals-card-custom',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goals-card-custom.component.html',
  styleUrls: ['./goals-card-custom.component.scss'],
})
export class GoalsCardCustomComponent {
  readonly goals = inject(GoalsService);
  /** a saved goal to show; absent = the "Create" card */
  @Input() set goal(g: CustomGoal | null | undefined) { this.g.set(g ?? null); }
  @Output() remove = new EventEmitter<string>();
  readonly g = signal<CustomGoal | null>(null);

  readonly chips: Chip[] = ([
    ['Wedding', '#f3a06a', 22, 54, '-6deg'], ["Kids' school", '#8fd65a', 236, 46, '5deg'],
    ['New car', '#7fb6f0', 34, 104, '4deg'], ["Parents' care", '#fbdb81', 228, 100, '-4deg'],
  ] as [string, string, number, number, string][]).map(([t, c, x, y, r], i) => ({ t, c, x: x + 'px', y: y + 'px', r, d: (0.1 + i * 0.08) + 's' }));

  readonly kindTxt = computed(() => { const g = this.g(); return g ? (KIND_ICON[g.kind] ?? 'Goal') : ''; });
  readonly amtTxt = computed(() => { const g = this.g(); return g ? this.goals.lakhShort(g.amount) : ''; });
  readonly whenTxt = computed(() => {
    const g = this.g(); if (!g) return '';
    if (g.type === 2) return 'every month';
    if (g.type === 1) return 'every ' + MONTHS[Math.max(0, Math.min(11, g.m))];
    const d = new Date(); d.setMonth(d.getMonth() + Math.max(0, g.m));
    return 'by ' + d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
  });
  readonly villasTxt = computed(() => { const g = this.g(); if (!g) return ''; return g.villas + (g.villas === 1 ? ' villa' : ' villas'); });
  readonly costTxt = computed(() => { const g = this.g(); return g ? this.goals.lakhShort(g.villas * this.goals.villaCost()) : ''; });
  readonly typeTxt = computed(() => { const g = this.g(); return g ? ['One time', 'Every year', 'Every month'][g.type] : ''; });

  onRemove(ev: Event): void { ev.stopPropagation(); const g = this.g(); if (g) this.remove.emit(g.id); }
}
