import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdminService, NetWorthRow } from '../admin.service';
import { AgendaItem, MeetStore } from './meet.store';

interface Draft {
  id: string | null;            // null = new meeting
  who: string;
  phone: string;
  client_code: string | null;
  title: string;
  date: string;                 // yyyy-mm-dd
  time: string;                 // HH:MM
  minutes: number;
  note: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

/**
 * Meeting room — admin home card. One fixed Google Meet link (start / copy /
 * share / change), plus a schedule the admin fills in. Meetings are saved on
 * the server and kept as history once they're over.
 */
@Component({
  selector: 'app-meet-room',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './meet-room.component.html',
  styleUrl: './meet-room.component.scss',
})
export class MeetRoomComponent implements OnInit {
  private api = inject(AdminService);
  readonly store = inject(MeetStore);

  /** the client directory, for the "With" picker */
  @Input() set clients(v: NetWorthRow[] | null) { this.clientList.set((v || []).filter((c) => !c.demo)); }
  readonly clientList = signal<NetWorthRow[]>([]);

  readonly tab = signal<'upcoming' | 'history'>('upcoming');
  readonly draft = signal<Draft | null>(null);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly toast = signal('');
  readonly menuFor = signal<string | null>(null);
  readonly shareOpen = signal(false);
  readonly editingRoom = signal(false);
  readonly roomDraft = signal('');
  readonly roomError = signal('');
  /** the (i) popover next to the Meet-link field */
  readonly linkInfo = signal(false);
  readonly historyQuery = signal('');
  private toastTimer: any = null;

  readonly durations = [15, 30, 45, 60, 90];

  ngOnInit(): void { this.store.load(); }

  // ── the room ──────────────────────────────────────────────────────────────
  readonly roomUrl = this.store.roomUrl;
  readonly roomShort = computed(() => this.roomUrl().replace(/^https?:\/\//, ''));

  start(): void { window.open(this.roomUrl(), '_blank', 'noopener'); }

  copyRoom(): void { this.copy(this.roomUrl(), 'Link copied'); }

  roomInvite(): string {
    return `Join me on Google Meet:\n${this.roomUrl()}\n\n— TheDigiCiti`;
  }

  get canNativeShare(): boolean { return typeof navigator !== 'undefined' && !!(navigator as any).share; }

  nativeShare(text: string): void {
    this.shareOpen.set(false);
    (navigator as any).share({ title: 'Google Meet', text }).catch(() => { /* dismissed */ });
  }

  whatsapp(text: string, phone = ''): string {
    const digits = phone.replace(/\D/g, '');
    const to = digits.length === 10 ? '91' + digits : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
  }

  mailto(text: string, subject = 'Our Google Meet call'): string {
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  }

  editRoom(): void {
    this.roomDraft.set(this.store.data()?.room.is_default ? '' : this.roomUrl());
    this.roomError.set('');
    this.linkInfo.set(false);
    this.editingRoom.set(true);
  }

  saveRoom(reset = false): void {
    const url = reset ? '' : this.roomDraft().trim();
    this.saving.set(true);
    this.api.setMeetRoom(url).subscribe({
      next: (room) => {
        this.store.patch((d) => ({ ...d, room }));
        this.editingRoom.set(false);
        this.saving.set(false);
        this.flash(reset ? 'Default room' : 'Link saved');
      },
      error: (e) => { this.roomError.set(e?.error?.detail || 'Could not save the link.'); this.saving.set(false); },
    });
  }

  // ── what's next ───────────────────────────────────────────────────────────
  readonly nextLabel = computed(() => {
    const n = this.store.next();
    if (!n) return '';
    const mins = Math.round((n.start.getTime() - this.store.now()) / 60_000);
    if (mins <= 0) return 'Live now';
    if (mins < 60) return `In ${mins} min`;
    const today = sameDay(n.start, new Date(this.store.now()));
    if (today) {
      const h = Math.floor(mins / 60), m = mins % 60;
      return `In ${h} h${m ? ` ${m} min` : ''}`;
    }
    return this.dayLabel(n.start);
  });

  readonly todayCount = computed(() => {
    const now = new Date(this.store.now());
    return this.store.upcoming().filter((a) => sameDay(a.start, now)).length;
  });

  // ── agenda ────────────────────────────────────────────────────────────────
  /** upcoming, grouped under Today / Tomorrow / weekday date */
  readonly groups = computed(() => {
    const out: { label: string; items: AgendaItem[] }[] = [];
    for (const a of this.store.upcoming()) {
      const label = this.dayLabel(a.start);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(a); else out.push({ label, items: [a] });
    }
    return out;
  });

  readonly historyItems = computed(() => {
    const q = this.historyQuery().trim().toLowerCase();
    const all = this.store.history();
    return q ? all.filter((a) => `${a.title} ${a.who} ${a.note}`.toLowerCase().includes(q)) : all;
  });

  dayLabel(d: Date): string {
    const now = new Date(this.store.now());
    const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, tmr)) return 'Tomorrow';
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  time(d: Date): string {
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ').toUpperCase();
  }

  isLive(a: AgendaItem): boolean {
    const now = this.store.now();
    return a.start.getTime() <= now && a.end.getTime() > now;
  }

  historyStatus(a: AgendaItem): string {
    if (a.status === 'cancelled') return 'Cancelled';
    if (a.status === 'done') return 'Done';
    return 'Past';
  }

  invite(a: AgendaItem): string {
    const hi = a.who ? `Hi ${a.who.split(' ')[0]}, here` : 'Here';
    const what = a.title && a.title !== 'Meeting' ? ` — ${a.title}` : '';
    const when = `${a.start.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} at ${this.time(a.start)} IST`;
    return `${hi}’s the link for our call${what}, ${when} (${a.minutes} min):\n${this.roomUrl()}\n\n— TheDigiCiti`;
  }

  copyInvite(a: AgendaItem): void { this.menuFor.set(null); this.copy(this.invite(a), 'Invite copied'); }

  calendarUrl(a: AgendaItem): string {
    const z = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: a.who ? `${a.title} · ${a.who}` : a.title,
      dates: `${z(a.start)}/${z(a.end)}`,
      details: `${a.note ? a.note + '\n\n' : ''}Join: ${this.roomUrl()}`,
      location: this.roomUrl(),
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  // ── schedule / edit ───────────────────────────────────────────────────────
  newMeeting(preset?: Partial<Draft>): void {
    // next round half-hour, at least 15 min out
    const d = new Date(this.store.now() + 15 * 60_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    this.formError.set('');
    this.draft.set({
      id: null, who: '', phone: '', client_code: null, title: '',
      date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, minutes: 30, note: '', ...preset,
    });
    this.tab.set('upcoming');
  }

  edit(a: AgendaItem): void {
    const m = a.meeting;
    if (!m) return;
    this.menuFor.set(null);
    this.formError.set('');
    this.draft.set({
      id: m.id, who: m.with_name, phone: m.with_phone || '', client_code: m.client_code || null, title: m.title,
      date: ymd(a.start), time: `${pad(a.start.getHours())}:${pad(a.start.getMinutes())}`, minutes: m.duration_min, note: m.note,
    });
  }

  /** "Again" from history: same people + title, new time */
  again(a: AgendaItem): void {
    this.newMeeting({ who: a.who, phone: a.phone, client_code: a.meeting?.client_code || null, title: a.source === 'mine' ? a.title : 'Follow-up call', minutes: a.minutes });
  }

  setDraft(patch: Partial<Draft>): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...patch });
  }

  /** typed into "With" — when it matches a client, fill their phone + code */
  onWho(v: string): void {
    const c = this.clientList().find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
    this.setDraft(c ? { who: c.name, phone: c.phone || this.draft()?.phone || '', client_code: c.client_code } : { who: v, client_code: null });
  }

  quickDate(offsetDays: number): void {
    const d = new Date(this.store.now());
    d.setDate(d.getDate() + offsetDays);
    this.setDraft({ date: ymd(d) });
  }

  isQuickDate(offsetDays: number): boolean {
    const d = new Date(this.store.now());
    d.setDate(d.getDate() + offsetDays);
    return this.draft()?.date === ymd(d);
  }

  readonly draftWhen = computed(() => {
    const d = this.draft();
    if (!d?.date || !d.time) return '';
    const s = new Date(`${d.date}T${d.time}`);
    if (isNaN(s.getTime())) return '';
    const e = new Date(s.getTime() + d.minutes * 60_000);
    const past = s.getTime() < this.store.now() - 60_000;
    return `${this.dayLabel(s)} · ${this.time(s)} – ${this.time(e)}${past ? ' · in the past' : ''}`;
  });

  save(): void {
    const d = this.draft();
    if (!d) return;
    if (!d.who.trim() && !d.title.trim()) { this.formError.set('Add who it’s with, or a title.'); return; }
    if (!d.date || !d.time) { this.formError.set('Pick a date and time.'); return; }
    const offset = -new Date(`${d.date}T${d.time}`).getTimezoneOffset();
    const tz = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    const body = {
      title: d.title.trim(), with_name: d.who.trim(), with_phone: d.phone.trim(), client_code: d.client_code,
      starts_at: `${d.date}T${d.time}${tz}`, duration_min: d.minutes, note: d.note.trim(),
    };
    this.saving.set(true);
    this.formError.set('');
    const req = d.id ? this.api.updateMeeting(d.id, body) : this.api.createMeeting(body);
    req.subscribe({
      next: (m) => {
        this.store.patch((o) => ({ ...o, meetings: d.id ? o.meetings.map((x) => (x.id === m.id ? m : x)) : [...o.meetings, m] }));
        this.saving.set(false);
        this.draft.set(null);
        this.flash(d.id ? 'Updated' : 'Scheduled');
      },
      error: (e) => { this.formError.set(e?.error?.detail || 'Could not save the meeting.'); this.saving.set(false); },
    });
  }

  setStatus(a: AgendaItem, status: 'scheduled' | 'done' | 'cancelled'): void {
    const m = a.meeting;
    if (!m) return;
    this.menuFor.set(null);
    this.api.updateMeeting(m.id, { status }).subscribe({
      next: (u) => {
        this.store.patch((o) => ({ ...o, meetings: o.meetings.map((x) => (x.id === u.id ? u : x)) }));
        this.flash(status === 'done' ? 'Done' : status === 'cancelled' ? 'Cancelled' : 'Restored');
      },
      error: () => this.flash('Could not update the meeting'),
    });
  }

  readonly confirmDelete = signal<string | null>(null);
  remove(a: AgendaItem): void {
    const m = a.meeting;
    if (!m) return;
    if (this.confirmDelete() !== m.id) { this.confirmDelete.set(m.id); return; }
    this.confirmDelete.set(null);
    this.menuFor.set(null);
    this.api.deleteMeeting(m.id).subscribe({
      next: () => { this.store.patch((o) => ({ ...o, meetings: o.meetings.filter((x) => x.id !== m.id) })); this.flash('Deleted'); },
      error: () => this.flash('Could not delete the meeting'),
    });
  }

  toggleMenu(key: string): void {
    this.confirmDelete.set(null);
    this.menuFor.set(this.menuFor() === key ? null : key);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  copy(text: string, msg: string): void {
    const done = () => this.flash(msg);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => this.copyFallback(text, done));
    } else this.copyFallback(text, done);
  }

  private copyFallback(text: string, done: () => void): void {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { this.flash('Copy failed — select the link and copy it'); }
    ta.remove();
  }

  flash(msg: string): void {
    this.toast.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2600);
  }

  initials(name: string): string {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  }

  trackKey = (_: number, a: AgendaItem) => a.key;
}
