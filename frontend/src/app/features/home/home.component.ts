import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

import { config } from '../../core/runtime-config';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [MatCardModule, MatButtonModule],
  template: `
    <mat-card>
      <mat-card-header>
        <mat-card-title>Welcome</mat-card-title>
        <mat-card-subtitle>FastAPI + Angular + Supabase</mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <p>Backend health: {{ status() }}</p>
      </mat-card-content>
      <mat-card-actions>
        <button mat-raised-button color="primary" (click)="ping()">Ping API</button>
      </mat-card-actions>
    </mat-card>
  `,
})
export class HomeComponent {
  private readonly http = inject(HttpClient);
  readonly status = signal('unknown');

  ping(): void {
    this.http
      .get<{ status: string }>(`${config.apiUrl}/health`)
      .subscribe({
        next: (res) => this.status.set(res.status),
        error: () => this.status.set('unreachable'),
      });
  }
}
