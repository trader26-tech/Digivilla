import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <mat-card style="max-width: 400px; margin: 0 auto">
      <mat-card-header><mat-card-title>Sign in</mat-card-title></mat-card-header>
      <mat-card-content>
        <mat-form-field appearance="outline" style="width: 100%">
          <mat-label>Email</mat-label>
          <input matInput type="email" [(ngModel)]="email" />
        </mat-form-field>
        <mat-form-field appearance="outline" style="width: 100%">
          <mat-label>Password</mat-label>
          <input matInput type="password" [(ngModel)]="password" />
        </mat-form-field>
        @if (error()) {
          <p style="color: var(--mat-sys-error, red)">{{ error() }}</p>
        }
      </mat-card-content>
      <mat-card-actions>
        <button mat-raised-button color="primary" (click)="login()">Sign in</button>
      </mat-card-actions>
    </mat-card>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly error = signal('');

  async login(): Promise<void> {
    this.error.set('');
    const { error } = await this.auth.signInWithPassword(this.email, this.password);
    if (error) {
      this.error.set(error.message);
      return;
    }
    void this.router.navigate(['/dashboard']);
  }
}
