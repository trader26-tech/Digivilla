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
import { GoalIntroComponent } from './goal-intro.component';
import { GoalPickerComponent } from './goal-picker.component';
import { GoalHomeComponent } from './goal-home.component';
import { GoalResultComponent } from './goal-result.component';
import { GoalTimingComponent } from './goal-timing.component';
import { HomeComponent } from './home.component';
import { IntroComponent } from './intro.component';
import { LandingComponent } from './landing.component';
import { AuthResponse, GoalPreset } from './models';
import { PlannerPanelComponent } from './planner-panel.component';
import { RefreshButtonComponent } from './refresh-button.component';
import { DevNavComponent, DevScreen } from './dev-nav.component';
import { PlannerService } from './planner.service';
import { inject } from '@angular/core';

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
    GoalTimingComponent,
    GoalResultComponent,
    GoalHomeComponent,
    IntroComponent,
    RefreshButtonComponent,
    DevNavComponent,
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

  /** First-screen flow, all pre-login:
   *    picker -> goal-intro (educate + calc) -> amount (knob) -> timing -> landing
   *  chosenGoal is set by the picker; the intro presets presetAmount; the knob
   *  confirms chosenAmount; timing confirms chosenYears. pickedGoal flips true
   *  only once timing is confirmed. */
  pickedGoal = false;
  chosenGoal: GoalPreset | null = null;
  amountDone = false; // combined intro+amount confirmed -> show timing
  chosenAmount = 0;
  chosenYears = 0;
  chosenMonthly = 0;  // monthly SIP, from the results screen
  timingDone = false; // timing confirmed -> show the results screen

  authed = !!localStorage.getItem('wp_token');
  userName = localStorage.getItem('wp_name') || '';

  /** A sample goal preset, loaded once, so the dev-nav can jump into the
   *  plan/home screens without walking the picker. */
  private sampleGoal: GoalPreset | null = null;
  private planner = inject(PlannerService);

  constructor() {
    this.planner.presets().subscribe({
      next: (list) => (this.sampleGoal = list[0] ?? null),
      error: () => {},
    });
  }

  /** Numeric index of the current pre-login screen, so the stepAnim trigger can
   *  tell forward (:increment) from back (:decrement). */
  get preStep(): number {
    if (!this.pickedGoal && !this.chosenGoal) return 0; // picker
    if (!this.pickedGoal && this.chosenGoal && !this.amountDone) return 1; // combined amount screen
    if (!this.pickedGoal && this.amountDone && !this.timingDone) return 2; // timing (skipped for short-term)
    if (!this.pickedGoal && this.timingDone) return 3; // results
    return 4; // home + quick login
  }

  /** ---- shared onboarding chrome (MyLakshyas brand + progress) ---- */
  /** Short label for each step, shown next to the progress. */
  readonly flowLabels = ['Goal', 'Amount', 'Timeline', 'Plan', 'Finish'];
  get flowTotal(): number {
    return this.flowLabels.length;
  }
  /** 1-based current step for display. */
  get flowStep(): number {
    return this.preStep + 1;
  }
  /** 0..1 fraction complete, for the progress fill width. */
  get flowFraction(): number {
    return this.flowStep / this.flowTotal;
  }
  /** Show the brand+progress chrome only during the pre-login flow. */
  get showChrome(): boolean {
    return !this.intro && !this.authed;
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

  /** The welcome animation finished -> reveal the goal picker. */
  onIntroDone(): void {
    this.intro = false;
  }

  /** User tapped Continue on a goal in the picker -> show the amount screen. */
  onGoalChosen(goal: GoalPreset): void {
    this.chosenGoal = goal;
    this.amountDone = false;
  }

  /** Combined amount screen confirmed -> move to the timing (date) screen. */
  onAmountChosen(amount: number): void {
    this.chosenAmount = amount;
    this.amountDone = true;
  }

  /** Back from the amount screen returns to the goal picker. */
  onAmountBack(): void {
    this.chosenGoal = null;
  }

  /** User confirmed a horizon on the timing screen -> show the results screen. */
  onTimingChosen(years: number): void {
    this.chosenYears = years;
    this.timingDone = true;
  }

  /** Back from the timing screen returns to the amount knob. */
  onTimingBack(): void {
    this.amountDone = false;
  }

  /** Results screen confirmed (goal added) -> show the dummy home + login sheet. */
  onResultContinue(monthly: number): void {
    this.chosenMonthly = monthly;
    this.pickedGoal = true;
  }

  /** Back from the results screen returns to the timing screen. */
  onResultBack(): void {
    this.timingDone = false;
  }

  /** Quick-login from the home sheet -> enter the app. The user has already
   *  passed Firebase phone-OTP in the sheet; here we store a lightweight local
   *  session (name + phone) so the authed shell renders. To make this a REAL
   *  session, send the Firebase idToken to the backend, verify it there with
   *  the Admin SDK, and swap the placeholder token below for the one it mints. */
  onQuickLogin(user: { name: string; phone: string }): void {
    const owner = 'usr_' + user.phone;
    localStorage.setItem('wp_token', 'quick_' + user.phone);
    localStorage.setItem('wp_owner', owner);
    localStorage.setItem('wp_name', user.name);
    localStorage.setItem('wp_phone', user.phone);
    this.userName = user.name;
    this.authed = true;
  }

  signOut(): void {
    localStorage.removeItem('wp_token');
    localStorage.removeItem('wp_owner');
    this.authed = false;
    this.tab = 'home';
    this.plannerOpen = false;
  }

  /** DEV: jump straight to any screen with sample data pre-filled. Wired to the
   *  floating "Jump" button so you don't have to walk the whole flow each time. */
  jumpTo(screen: DevScreen): void {
    // reset all flow flags to a clean slate first
    this.intro = false;
    this.pickedGoal = false;
    this.chosenGoal = null;
    this.amountDone = false;
    this.timingDone = false;
    this.plannerOpen = false;

    const g = this.sampleGoal;
    // sensible sample values for screens that need a goal + amount + horizon
    const withGoal = () => {
      this.chosenGoal = g;
      this.chosenAmount = g?.default_amount || 300000;
      this.chosenYears = g?.default_years || 2;
      this.chosenMonthly = 11614;
    };

    switch (screen) {
      case 'intro':
        this.intro = true;
        this.authed = false;
        break;
      case 'picker':
        this.authed = false;
        break;
      case 'amount':
        this.authed = false;
        withGoal();
        break; // chosenGoal set, amountDone false -> amount screen
      case 'timing':
        this.authed = false;
        withGoal();
        this.amountDone = true;
        break;
      case 'plan':
      case 'plan-invest':
      case 'plan-returns':
      case 'celebrate':
        this.authed = false;
        withGoal();
        this.amountDone = true;
        this.timingDone = true;
        // deep-link into a sub-view of the plan screen after it renders
        this.pendingPlanView = screen;
        break;
      case 'home':
        this.authed = false;
        withGoal();
        this.pickedGoal = true;
        break;
      case 'landing':
        this.authed = false;
        withGoal();
        this.pickedGoal = true;
        // the landing/sign-in shows via goal-home's login sheet; keep it simple
        break;
      case 'dashboard':
        withGoal();
        this.pickedGoal = true;
        this.ensureDevSession();
        this.authed = true;
        this.tab = 'home';
        break;
      case 'basket':
        withGoal();
        this.pickedGoal = true;
        this.ensureDevSession();
        this.authed = true;
        this.tab = 'invest';
        break;
    }
  }

  /** The plan sub-view to auto-open (invest/returns/celebrate) after jumping. */
  pendingPlanView: DevScreen | null = null;

  /** Give the authed shell a throwaway session so dashboard/basket render. */
  private ensureDevSession(): void {
    if (!localStorage.getItem('wp_token')) {
      localStorage.setItem('wp_token', 'dev');
      localStorage.setItem('wp_owner', 'usr_dev');
      localStorage.setItem('wp_name', 'Dev');
      this.userName = 'Dev';
    }
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
