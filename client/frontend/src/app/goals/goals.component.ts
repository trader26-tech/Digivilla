import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';

import { GoalsService } from './goals.service';
import { GoalsHubComponent } from './goals-hub.component';
import { GoalsPayoutComponent } from './goals-payout.component';
import { GoalsTripBuilderComponent } from './goals-trip-builder.component';
import { GoalsTripFundComponent } from './goals-trip-fund.component';
import { GoalsCreateComponent } from './goals-create.component';

/** The Goals tab: a small flow of full-screen pages (hub → payout dial / trip
 *  builder → trip fund / create a goal). The hub's back arrow returns to Home. */
@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [CommonModule, GoalsHubComponent, GoalsPayoutComponent, GoalsTripBuilderComponent, GoalsTripFundComponent, GoalsCreateComponent],
  template: `
    @switch (goals.page()) {
      @case ('payout') { <app-goals-payout (back)="go('hub')"></app-goals-payout> }
      @case ('trip-builder') { <app-goals-trip-builder (back)="go('hub')" (fund)="go('trip-fund')"></app-goals-trip-builder> }
      @case ('trip-fund') { <app-goals-trip-fund (back)="go('hub')" (done)="go('hub')"></app-goals-trip-fund> }
      @case ('create') { <app-goals-create (back)="go('hub')" (done)="go('hub')"></app-goals-create> }
      @default { <app-goals-hub (back)="home.emit()" (open)="go($event)"></app-goals-hub> }
    }
  `,
  styles: [`:host { display: block; min-height: 100dvh; background: #05060c; }`],
})
export class GoalsComponent implements OnInit {
  readonly goals = inject(GoalsService);
  /** the hub's back arrow → the Home tab */
  @Output() home = new EventEmitter<void>();
  ngOnInit(): void { this.goals.load(); }
  go(p: 'hub' | 'payout' | 'trip-builder' | 'trip-fund' | 'create'): void { this.goals.page.set(p); window.scrollTo({ top: 0 }); }
}
