import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="topnav">
      <a routerLink="/" class="brand">
        <span class="logo">◈</span>
        <span>FundLens</span>
      </a>
      <div class="links">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          Dashboard
        </a>
        <a routerLink="/funds" routerLinkActive="active">Explore</a>
      </div>
    </nav>
    <main>
      <router-outlet />
    </main>
    <footer>
      Data: AMFI &amp; mfapi.in · Metrics computed from NAV history · Not investment advice
    </footer>
  `,
  styles: [
    `
      .topnav {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 24px;
        background: color-mix(in srgb, var(--surface) 88%, transparent);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--border);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 800;
        font-size: 18px;
        color: var(--text);
        text-decoration: none;
        letter-spacing: -0.02em;
      }
      .logo {
        color: var(--accent);
        font-size: 20px;
      }
      .links {
        display: flex;
        gap: 6px;
      }
      .links a {
        padding: 8px 16px;
        border-radius: 10px;
        color: var(--muted);
        text-decoration: none;
        font-weight: 500;
        font-size: 14px;
        transition: background 0.15s, color 0.15s;
      }
      .links a:hover {
        background: var(--surface-2);
        color: var(--text);
      }
      .links a.active {
        background: color-mix(in srgb, var(--accent) 14%, transparent);
        color: var(--accent);
      }
      main {
        min-height: calc(100vh - 120px);
      }
      footer {
        text-align: center;
        padding: 24px;
        color: var(--muted);
        font-size: 12px;
        border-top: 1px solid var(--border);
      }
    `,
  ],
})
export class AppComponent {}
