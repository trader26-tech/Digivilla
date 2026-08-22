import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import {
  animate,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';

import { BasketLabComponent } from './basket-lab.component';
import { GoalAmountComponent } from './goal-amount.component';
import { GoalIntroComponent } from './goal-intro.component';
import { GoalPickerComponent } from './goal-picker.component';
import { GoalTimingComponent } from './goal-timing.component';
import { HomeComponent } from './home.component';
import { IntroComponent } from './intro.component';
import { LandingComponent } from './landing.component';
import { AuthResponse, GoalPreset } from './models';
import { PlannerPanelComponent } from './planner-panel.component';
import { StoryComponent } from './story.component';

type Tab = 'home' | 'invest';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HomeComponent,
    BasketLabComponent,
    PlannerPanelComponent,
    LandingComponent,
    GoalPickerComponent,
    GoalIntroComponent,
    GoalAmountComponent,
    GoalTimingComponent,
    IntroComponent,
    StoryComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  animations: [
    // Advancing flow: the new screen slides in from the right while the old
    // one slides out to the left; going back reverses it. Both are absolutely
    // positioned during the transition so they overlap cleanly.
    trigger('stepAnim', [
      transition(':increment', [
        query(':enter, :leave', style({ position: 'absolute', inset: 0 }), { optional: true }),
        query(':enter', style({ transform: 'translateX(40px)', opacity: 0 }), { optional: true }),
        group([
          query(':leave', [animate('380ms cubic-bezier(0.22,1,0.36,1)', style({ transform: 'translateX(-40px)', opacity: 0 }))], { optional: true }),
          query(':enter', [animate('380ms cubic-bezier(0.22,1,0.36,1)', style({ transform: 'translateX(0)', opacity: 1 }))], { optional: true }),
        ]),
      ]),
      transition(':decrement', [
        query(':enter, :leave', style({ position: 'absolute', inset: 0 }), { optional: true }),
        query(':enter', style({ transform: 'translateX(-40px)', opacity: 0 }), { optional: true }),
        group([
          query(':leave', [animate('380ms cubic-bezier(0.22,1,0.36,1)', style({ transform: 'translateX(40px)', opacity: 0 }))], { optional: true }),
          query(':enter', [animate('380ms cubic-bezier(0.22,1,0.36,1)', style({ transform: 'translateX(0)', opacity: 1 }))], { optional: true }),
        ]),
      ]),
    ]),
  ],
})
export class AppComponent {
  tab: Tab = 'home';
  plannerOpen = false;
  goalsVersion = 0;

  /** Cinematic welcome shown on every launch, before anything else. */
  intro = true;

  /** The playful "why invest / why us" story shown after the intro, before the
   *  goal picker. Flows into the picker when finished or skipped. */
  story = true;

  /** First-screen flow, all pre-login:
   *    goal-picker -> goal-amount (knob) -> goal-timing (horizon) -> landing/auth
   *  chosenGoal is set by the picker; chosenAmount by the knob; chosenYears by
   *  the timing screen. pickedGoal flips true only once timing is confirmed. */
  pickedGoal = false;
  chosenGoal: GoalPreset | null = null;
  chosenAmount = 0;
  amountDone = false; // amount confirmed -> show timing screen
  chosenYears = 0;

  authed = !!localStorage.getItem('wp_token');
  userName = localStorage.getItem('wp_name') || '';

  /** Numeric index of the current pre-login screen, so the stepAnim trigger can
   *  tell forward (:increment) from back (:decrement). */
  get preStep(): number {
    if (!this.pickedGoal && !this.chosenGoal) return 0; // picker
    if (!this.pickedGoal && this.chosenGoal && !this.amountDone) return 1; // amount knob
    if (!this.pickedGoal && this.amountDone) return 2; // timing
    return 3; // landing / auth
  }

  /** Called when the landing page completes sign-in. Persists the session
   *  token and the server-issued owner id so goals belong to this user
   *  (PlannerService.owner reads wp_owner). */
  onAuthed(res: AuthResponse): void {
    localStorage.setItem('wp_token', res.token);
    localStorage.setItem('wp_owner', res.user.owner);
    localStorage.setItem('wp_name', res.user.name || res.user.email.split('@')[0]);
    this.userName = localStorage.getItem('wp_name') || '';
    this.authed = true;
  }

  /** The welcome animation finished -> reveal the "why invest" story. */
  onIntroDone(): void {
    this.intro = false;
  }

  /** The story finished (or was skipped) -> reveal the goal picker. */
  onStoryDone(): void {
    this.story = false;
  }

  /** User tapped Continue on a goal in the picker -> show the amount knob. */
  onGoalChosen(goal: GoalPreset): void {
    this.chosenGoal = goal;
  }

  /** User confirmed an amount on the knob screen -> move to the timing screen. */
  onAmountChosen(amount: number): void {
    this.chosenAmount = amount;
    this.amountDone = true;
  }

  /** Back from the amount screen returns to the goal picker. */
  onAmountBack(): void {
    this.chosenGoal = null;
  }

  /** User confirmed a horizon on the timing screen -> move to auth. */
  onTimingChosen(years: number): void {
    this.chosenYears = years;
    this.pickedGoal = true;
  }

  /** Back from the timing screen returns to the amount knob. */
  onTimingBack(): void {
    this.amountDone = false;
  }

  signOut(): void {
    localStorage.removeItem('wp_token');
    localStorage.removeItem('wp_owner');
    this.authed = false;
    this.tab = 'home';
    this.plannerOpen = false;
  }

  setTab(t: Tab): void {
    this.tab = t;
  }

  togglePlanner(): void {
    this.plannerOpen = !this.plannerOpen;
  }
  closePlanner(): void {
    this.plannerOpen = false;
  }

  onGoalSaved(): void {
    this.goalsVersion++;
    this.tab = 'home';
    this.plannerOpen = false;
  }
  onBasketSaved(): void {
    this.goalsVersion++;
    this.tab = 'home';
  }
}
