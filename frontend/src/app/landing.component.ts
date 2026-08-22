import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChildren,
  QueryList,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthResponse } from './models';
import { PlannerService } from './planner.service';

type Mode = 'signin' | 'signup';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent implements AfterViewInit, OnDestroy {
  /** Emits the authenticated session when the user enters the app. */
  @Output() authed = new EventEmitter<AuthResponse>();

  constructor(private api: PlannerService) {}

  mode: Mode = 'signup';
  name = '';
  email = '';
  password = '';
  submitting = false;
  error = '';

  /** Animated stat counters — [current, target, suffix]. */
  readonly stats = [
    { label: 'Assets planned for clients', value: 0, target: 480, prefix: '₹', suffix: ' Cr+' },
    { label: 'Goals funded on track', value: 0, target: 12000, prefix: '', suffix: '+' },
    { label: 'Avg. plan success rate', value: 0, target: 92, prefix: '', suffix: '%' },
  ];

  readonly features = [
    {
      icon: '◎',
      title: 'Goal-first, not product-first',
      body: 'We start from your dream — a home, retirement, your child’s education — and reverse-engineer the exact plan to get there.',
    },
    {
      icon: '◈',
      title: 'Research you can trust',
      body: 'Every fund is scored on returns, risk, consistency and cost. No commissions cloud the recommendation — only what fits your goal.',
    },
    {
      icon: '⚡',
      title: 'Monte-Carlo confidence',
      body: 'We run thousands of market simulations so you see the range of outcomes — and the odds of hitting your target, not just a rosy line.',
    },
    {
      icon: '◇',
      title: 'One clear plan, always on',
      body: 'Track every goal, SIP and projection in one place. Rebalance suggestions arrive before you need them, not after.',
    },
  ];

  readonly steps = [
    { n: '01', title: 'Tell us your goal', body: 'Amount, timeline, and how you feel about risk. Sixty seconds, no jargon.' },
    { n: '02', title: 'Get a tailored basket', body: 'A hand-researched mix of funds built to hit that specific goal.' },
    { n: '03', title: 'Watch it compound', body: 'Live projections, success odds, and nudges keep you on track for good.' },
  ];

  @ViewChildren('reveal') reveals!: QueryList<ElementRef<HTMLElement>>;
  private io?: IntersectionObserver;
  private countersStarted = false;

  ngAfterViewInit(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.reveals?.forEach((r) => r.nativeElement.classList.add('in'));
      this.stats.forEach((s) => (s.value = s.target));
      return;
    }

    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            if ((e.target as HTMLElement).dataset['stats'] && !this.countersStarted) {
              this.countersStarted = true;
              this.runCounters();
            }
            this.io?.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18 },
    );
    this.reveals?.forEach((r) => this.io!.observe(r.nativeElement));
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
  }

  private runCounters(): void {
    const start = performance.now();
    const dur = 1400;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const k = ease(t);
      for (const s of this.stats) s.value = Math.round(s.target * k);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.error = '';
  }

  private validEmail(v: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  submit(): void {
    if (this.submitting) return;
    this.error = '';
    const email = this.email.trim();
    const name = this.name.trim();
    if (!this.validEmail(email)) {
      this.error = 'Please enter a valid email address.';
      return;
    }
    if (this.mode === 'signup' && name.length < 2) {
      this.error = 'Tell us your name so we can personalise your plan.';
      return;
    }
    if (this.password.length < 6) {
      this.error = 'Password must be at least 6 characters.';
      return;
    }

    this.submitting = true;
    const req$ =
      this.mode === 'signup'
        ? this.api.signup(email, this.password, name)
        : this.api.login(email, this.password);

    req$.subscribe({
      next: (res) => {
        // Small delay lets the exit animation play before the app mounts.
        window.setTimeout(() => this.authed.emit(res), 500);
      },
      error: (e) => {
        this.submitting = false;
        this.error =
          e?.error?.detail ||
          (e?.status === 0
            ? 'Cannot reach the server. Please try again.'
            : 'Something went wrong. Please try again.');
      },
    });
  }
}
