import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/funds/fund-dashboard.component').then(
        (m) => m.FundDashboardComponent,
      ),
  },
  {
    path: 'funds',
    loadComponent: () =>
      import('./features/funds/fund-explorer.component').then(
        (m) => m.FundExplorerComponent,
      ),
  },
  {
    path: 'funds/:code',
    loadComponent: () =>
      import('./features/funds/fund-detail.component').then(
        (m) => m.FundDetailComponent,
      ),
  },
  {
    path: 'auth/login',
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  { path: '**', redirectTo: '' },
];
