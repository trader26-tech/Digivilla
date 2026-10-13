import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnInit, ViewChild, computed, inject, signal } from '@angular/core';

import { NetWorthRow } from '../admin.service';
import { MeetRoomComponent } from '../meet/meet-room.component';
import { AgendaItem, MeetStore } from '../meet/meet.store';

/** Home card: the Meet room at a glance — join/copy, what's next, today's list.
 *  "Schedule" and "All" open the full meeting manager (<app-meet-room>) in a sheet. */
@Component({
  selector: 'app-meet-card',
  standalone: true,
  imports: [CommonModule, MeetRoomComponent],
  templateUrl: './meet-card.component.html',
  styleUrl: './home-cards.scss',
})
export class MeetCardComponent implements OnInit {
  readonly store = inject(MeetStore);
  @Input() clients: NetWorthRow[] | null = null;
  @ViewChild(MeetRoomComponent) room?: MeetRoomComponent;

  readonly sheet = signal(false);
  readonly copied = signal(false);

  ngOnInit(): void { if (!this.store.data()) this.store.load(); }

  readonly roomShort = computed(() => this.store.roomUrl().replace(/^https?:\/\//, ''));
  /** the next few, soonest first */
  readonly soon = computed(() => this.store.upcoming().slice(0, 3));
  readonly more = computed(() => Math.max(0, this.store.upcoming().length - 3));

  start(): void { window.open(this.store.roomUrl(), '_blank', 'noopener'); }
  copy(): void {
    navigator.clipboard?.writeText(this.store.roomUrl()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    }).catch(() => { /* no clipboard */ });
  }
  openSheet(schedule: boolean): void {
    this.sheet.set(true);
    if (schedule) setTimeout(() => this.room?.newMeeting(), 0);
  }
  @HostListener('document:keydown.escape')
  close(): void { this.sheet.set(false); }

  isLive(a: AgendaItem): boolean { const n = this.store.now(); return a.start.getTime() <= n && a.end.getTime() > n; }
  when(a: AgendaItem): string {
    const n = this.store.now(), ms = a.start.getTime() - n;
    if (this.isLive(a)) return 'Live';
    if (ms < 60 * 60_000) return 'in ' + Math.max(1, Math.round(ms / 60_000)) + ' min';
    const d = a.start, today = new Date(n);
    const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return t;
    const tm = new Date(today); tm.setDate(tm.getDate() + 1);
    if (d.toDateString() === tm.toDateString()) return 'Tomorrow ' + t;
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + t;
  }
}
