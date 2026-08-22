import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { BasketLabComponent } from './basket-lab.component';
import { GoalPickerComponent } from './goal-picker.component';
import { HomeComponent } from './home.component';
import { LandingComponent } from './landing.component';
import { AuthResponse, GoalPreset } from './models';
import { PlannerPanelComponent } from './planner-panel.component';

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
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  tab: Tab = 'home';
  plannerOpen = false;
  goalsVersion = 0;

  /** The app's very first screen is the no-login goal picker. Once the user
   *  picks a goal (or has already been here), we move on to the rest of the
   *  flow. Persisted so returning PWA users don't see it every launch. */
  pickedGoal = false;
  chosenGoal: GoalPreset | null = null;

  authed = !!localStorage.getItem('wp_token');
  userName = localStorage.getItem('wp_name') || '';

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

  /** User tapped Continue on a goal in the first-screen picker. We remember
   *  the choice; the downstream flow (planner prefill / auth) is wired later. */
  onGoalChosen(goal: GoalPreset): void {
    this.chosenGoal = goal;
    this.pickedGoal = true;
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
