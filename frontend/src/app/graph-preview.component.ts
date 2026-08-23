import { Component } from '@angular/core';
import { GoalResultComponent } from './goal-result.component';
import { GoalPreset } from './models';

/** TEMP dev-only harness to preview the goal-result graph in isolation. */
@Component({
  selector: 'app-graph-preview',
  standalone: true,
  imports: [GoalResultComponent],
  template: `<app-goal-result [goal]="goal" [amount]="1754671" [years]="10"></app-goal-result>`,
})
export class GraphPreviewComponent {
  goal: GoalPreset = {
    key: 'house', label: 'Buy a House', icon: '🏠',
    default_amount: 1754671, suggested_amounts: [], default_years: 10,
    default_risk: 'balanced', blurb: '',
  };
}
