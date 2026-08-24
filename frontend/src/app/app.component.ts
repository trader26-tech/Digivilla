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

import { GoalIntroComponent } from './goal-intro.component';
import { GoalPickerComponent } from './goal-picker.component';
import { GoalHomeComponent } from './goal-home.component';
import { GoalResultComponent } from './goal-result.component';
import { GoalTimingComponent } from './goal-timing.component';
import { GoalDetailComponent } from './goal-detail.component';
import { WelcomeGateComponent } from './welcome-gate.component';
import { HomeComponent } from './home.component';
import { IntroComponent } from './intro.component';
import { LandingComponent } from './landing.component';
import { AuthResponse, Goal, GoalCreate, GoalPreset } from './models';
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
    LandingComponent,
    GoalPickerComponent,
    GoalIntroComponent,
    GoalTimingComponent,
    WelcomeGateComponent,
    GoalResultComponent,
    GoalDetailComponent,
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
  goalsVersion = 0;

  /** The goal whose full detail page is open, or null for the dashboard. */
  selectedGoal: Goal | null = null;

  /** Cinematic welcome shown on every launch, before anything else. */
  intro = true;

  /** After the intro: the "why us" welcome gate with Log in / Get started.
   *  Stays true until the user either logs in or taps Get started. */
  gate = true;

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
  /** Show the brand+progress chrome only during the goal-building flow —
   *  not on the intro, the welcome gate, or once authed. */
  get showChrome(): boolean {
    return !this.intro && !this.gate && !this.authed;
  }

  /** Called when the landing page completes sign-in. Persists the session
   *  token and the server-issued owner id so goals belong to this user
   *  (PlannerService.owner reads wp_owner). */
  onAuthed(res: AuthResponse): void {
    localStorage.setItem('wp_token', res.token);
    localStorage.setItem('wp_owner', res.user.owner);
    // Phone users get a synthetic "phone+…@mylakshyas.local" email — never show
    // that as a name; only use a real (non-synthetic) email local-part.
    const email = res.user.email || '';
    const emailName = email.includes('@mylakshyas.local') ? '' : email.split('@')[0];
    localStorage.setItem('wp_name', res.user.name || emailName);
    this.userName = localStorage.getItem('wp_name') || '';
    this.authed = true;
  }

  /** The welcome animation finished -> reveal the "why us" welcome gate. */
  onIntroDone(): void {
    this.intro = false;
  }

  /** New user tapped "Get started" on the gate -> begin the goal flow. */
  onGateStart(): void {
    this.gate = false;
  }

  /** Returning user logged in from the gate -> straight to the dashboard,
   *  skipping the whole goal-building flow. */
  onGateLogin(res: AuthResponse): void {
    this.gate = false;
    this.onAuthed(res);
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

  /** Results screen confirmed. During onboarding -> the home + login sheet.
   *  While already signed in (adding a goal) -> save it and return to Home. */
  onResultContinue(monthly: number): void {
    this.chosenMonthly = monthly;
    if (this.addingGoal && this.authed) {
      this.saveNewGoal(monthly);
      return;
    }
    this.pickedGoal = true;
  }

  /** Back from the results screen returns to the timing screen. */
  onResultBack(): void {
    this.timingDone = false;
  }

  // ============================================================
  //  Add a goal AFTER sign-in — reuse the whole onboarding flow
  //  (picker -> amount -> timing -> plan) as a full-screen overlay.
  // ============================================================

  /** True while the signed-in user is running the add-goal flow. */
  addingGoal = false;

  /** Home "+" / add-goal -> launch the onboarding flow fresh. */
  startAddGoal(): void {
    this.chosenGoal = null;
    this.amountDone = false;
    this.timingDone = false;
    this.chosenAmount = 0;
    this.chosenYears = 0;
    this.chosenMonthly = 0;
    this.addingGoal = true;
  }

  /** Leave the add-goal flow without saving. */
  cancelAddGoal(): void {
    this.addingGoal = false;
    this.chosenGoal = null;
    this.amountDone = false;
    this.timingDone = false;
  }

  /** Numeric step for the add-goal overlay's slide animation. */
  get addStep(): number {
    if (!this.chosenGoal) return 0;             // picker
    if (this.chosenGoal && !this.amountDone) return 1; // amount
    if (this.amountDone && !this.timingDone) return 2; // timing
    return 3;                                    // result
  }

  /** Persist the just-built goal, then close the overlay and refresh Home. */
  private saveNewGoal(monthly: number): void {
    const g = this.chosenGoal;
    if (!g) {
      this.addingGoal = false;
      return;
    }
    const risk = g.default_risk || 'balanced';
    const rate = risk === 'aggressive' ? 0.12 : risk === 'conservative' ? 0.07 : 0.1;
    const target = this.chosenAmount;
    this.planner
      .saveGoal({
        goal: g.key,
        label: g.label,
        target_amount: target,
        horizon_years: this.chosenYears,
        resolved_risk: risk,
        monthly_investment: monthly,
        expected_return: rate,
        projected_p50: target,
        projected_p10: Math.round(target * 0.8),
        projected_p90: Math.round(target * 1.25),
        success_rate: 0.85,
        recommendations: [],
      } as GoalCreate)
      .subscribe({
        next: () => this.finishAddGoal(),
        error: (err) => {
          console.error('saveGoal failed', err);
          this.finishAddGoal(); // never dead-end the UI
        },
      });
  }

  private finishAddGoal(): void {
    this.addingGoal = false;
    this.chosenGoal = null;
    this.amountDone = false;
    this.timingDone = false;
    this.goalsVersion++; // tell Home to reload its goals
    this.tab = 'home';
  }

  /** Quick-login from the home sheet -> enter the app. The user has already
   *  passed Firebase phone-OTP; exchange it for a REAL backend session at
   *  /auth/phone (the server verifies the Firebase ID token with the Admin SDK
   *  when configured, and returns our stateless token keyed to the user). If
   *  the backend is unreachable we fall back to a local session so the flow
   *  never dead-ends. */
  onQuickLogin(user: { name: string; phone: string; idToken: string }): void {
    localStorage.setItem('wp_name', user.name);
    localStorage.setItem('wp_phone', user.phone);
    this.userName = user.name;

    this.planner.phoneLogin(user.name, user.phone, user.idToken).subscribe({
      next: (res) => {
        localStorage.setItem('wp_token', res.token);
        localStorage.setItem('wp_owner', res.user.owner);
        localStorage.setItem('wp_name', res.user.name || user.name);
        this.userName = res.user.name || user.name;
        this.authed = true;
      },
      error: () => {
        // Backend unavailable — keep a local session so the user still gets in.
        localStorage.setItem('wp_token', 'local_' + user.phone);
        localStorage.setItem('wp_owner', 'usr_' + user.phone);
        this.authed = true;
      },
    });
  }

  signOut(): void {
    localStorage.removeItem('wp_token');
    localStorage.removeItem('wp_owner');
    this.authed = false;
    this.tab = 'home';
    this.addingGoal = false;
    this.selectedGoal = null;
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
    this.addingGoal = false;

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

  /** Home goal tapped -> open its full detail page. */
  openGoalDetail(g: Goal): void {
    this.selectedGoal = g;
  }
  /** Back from the goal detail page -> return to the dashboard. */
  closeGoalDetail(): void {
    this.selectedGoal = null;
    // A withdrawal/edit could have changed the numbers; refresh Home on return.
    this.goalsVersion++;
  }

  onBasketSaved(): void {
    this.goalsVersion++;
    this.tab = 'home';
  }
}
