import { Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MatToolbarModule],
  template: `
    <mat-toolbar color="primary">
      <span routerLink="/" style="cursor: pointer">Retirement</span>
      <span style="flex: 1 1 auto"></span>
    </mat-toolbar>
    <main style="padding: 24px">
      <router-outlet />
    </main>
  `,
})
export class AppComponent {}
