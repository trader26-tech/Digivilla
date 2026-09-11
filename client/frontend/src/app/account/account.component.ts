import { CommonModule, DatePipe } from '@angular/common';
import {
  Component, ElementRef, EventEmitter, Output, ViewChild,
  computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../auth/auth.service';
import { AccountOrder, ClientDetails, EstateService } from '../estate.service';
import { AppUpdateService } from '../shared/app-update.service';
import { inr } from '../shared/format.util';

/** localStorage key for the user-uploaded avatar (shared with the details panel). */
const AVATAR_KEY = 'sc.avatar';

/** The coloured sleeve tag hues — the SAME hex as the Home allocation bar. */
const TAG_COLOUR: Record<string, string> = {
  ARB: '#8fb7b0',
  GOLD: '#e9c15c',
  MID: '#6ac86a',
  SMALL: '#58b858',
  LARGE: '#9184d9',
};

type SortKey = 'date' | 'old' | 'amt' | 'fund';
type FilterKey = 'all' | 'Lumpsum' | 'Purchase' | 'Payout';

/** A block of orders under one heading (date, or fund when sorted "By fund"). */
interface OrderGroup { head: string; rows: AccountOrder[]; }

/**
 * Settings page — the app's account hub. Reached from the bottom-nav SETTINGS
 * tab AND from the home avatar. Identity header, a 4-min presentation poster,
 * an "Account" card (Transactions · Personal details · Call your advisor ·
 * Book a call), an "Update to latest" card and a disclaimer. Two full-screen
 * panels slide up over it: Transactions (#ap-tx) and Personal details (#ap-me),
 * both wired to REAL client data (est.orders() / est.details()).
 */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss',
})
export class AccountComponent {
  @Output() back = new EventEmitter<void>();
  /** Asks the shell to sign the user out. */
  @Output() signOut = new EventEmitter<void>();
  /** Asks the shell to open the existing booking / calls flow. */
  @Output() book = new EventEmitter<void>();

  @ViewChild('avFileTop') avFileTop?: ElementRef<HTMLInputElement>;
  @ViewChild('avFileMe') avFileMe?: ElementRef<HTMLInputElement>;

  readonly est = inject(EstateService);
  private readonly auth = inject(AuthService);
  private readonly updater = inject(AppUpdateService);
  private readonly datePipe = new DatePipe('en-IN');

  // ---- REAL client data ----------------------------------------------------
  /** Client personal details (GET /me/details). Null until loaded. */
  readonly details = signal<ClientDetails | null>(null);
  /** Real fund orders (GET /me/orders). */
  readonly orders = signal<AccountOrder[]>([]);
  readonly ordersLoaded = signal(false);

  /** The uploaded avatar (data URL) — mirrored to every avatar on the page. */
  readonly avatar = signal<string>(this.loadAvatar());

  constructor() {
    // Load both feeds on init so the identity header and the Account row
    // sublines are correct before the panels are opened.
    this.est.details().subscribe({
      next: (d) => { this.details.set(d); this.prefill(); },
      error: () => this.details.set(null),
    });
    this.est.orders().subscribe({
      next: (r) => { this.orders.set(r.orders || []); this.ordersLoaded.set(true); },
      error: () => { this.orders.set([]); this.ordersLoaded.set(true); },
    });
  }

  // ---- identity -------------------------------------------------------------
  /** Title-case a raw CRM name ("RAMPRASAD RANJEEV" → "Ramprasad Ranjeev"). */
  private titleCase(s: string): string {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  /** Real name, nicely cased: client record → estate name → auth → "". */
  get idName(): string {
    const raw =
      this.details()?.name?.trim() ||
      this.est.estateName?.trim() ||
      this.auth.user()?.name?.trim() ||
      this.est.profile().name?.trim() ||
      '';
    return raw ? this.titleCase(raw) : '';
  }
  /** Real phone: locally edited → client record → profile → auth, prettied. */
  private readonly editedPhone = signal<string | null>(null);
  get idPhone(): string {
    const raw =
      this.editedPhone() ??
      (this.details()?.phone?.trim() ||
        this.est.profile().phone?.trim() ||
        this.auth.user()?.phone?.trim() ||
        '');
    return this.prettyPhone(raw);
  }
  /** "+918925188870" → "+91 89251 88870"; leaves other formats as-is. */
  prettyPhone(p: string): string {
    if (!p) return '';
    const digits = p.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      const n = digits.slice(2);
      return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
    }
    if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    return p;
  }
  /** The avatar initial — first letter of the real name, or "•". */
  get idInitial(): string {
    const n = this.idName;
    return n ? n.charAt(0).toUpperCase() : '•';
  }

  onSignOut(): void { this.signOut.emit(); }
  onBack(): void { this.back.emit(); }
  onBook(): void { this.book.emit(); }

  // ---- avatar upload (localStorage sc.avatar, mirrored to both avatars) -----
  private loadAvatar(): string {
    try { return localStorage.getItem(AVATAR_KEY) || ''; } catch { return ''; }
  }
  pickTop(): void { this.avFileTop?.nativeElement.click(); }
  pickMe(): void { this.avFileMe?.nativeElement.click(); }
  onAvatarChosen(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (url) {
        this.avatar.set(url);
        try { localStorage.setItem(AVATAR_KEY, url); } catch {}
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  // ---- panels ---------------------------------------------------------------
  /** 'tx' | 'me' | null — which full-screen panel is open. */
  readonly panel = signal<'tx' | 'me' | null>(null);
  openPanel(p: 'tx' | 'me'): void { this.panel.set(p); }
  closePanel(): void { this.panel.set(null); }

  // ---- Transactions panel ---------------------------------------------------
  readonly txQuery = signal('');
  readonly txFilter = signal<FilterKey>('all');
  readonly txSort = signal<SortKey>('date');
  readonly txSortOpen = signal(false);

  setFilter(f: FilterKey): void { this.txFilter.set(f); }
  setSort(s: SortKey): void { this.txSort.set(s); this.txSortOpen.set(false); }
  toggleSortMenu(): void { this.txSortOpen.update((v) => !v); }

  /** Orders that pass the search + filter, honouring the current sort. */
  readonly filteredOrders = computed<AccountOrder[]>(() => {
    const q = this.txQuery().trim().toLowerCase();
    const f = this.txFilter();
    let list = this.orders().filter((o) => {
      if (q && !o.fund.toLowerCase().includes(q)) return false;
      if (f === 'all') return true;
      if (f === 'Payout') return o.direction === 'out';
      return o.kind === f;
    });
    const byDate = (a: AccountOrder, b: AccountOrder) => a.date.localeCompare(b.date);
    switch (this.txSort()) {
      case 'old': list = [...list].sort(byDate); break;
      case 'amt': list = [...list].sort((a, b) => b.amount - a.amount); break;
      case 'fund': list = [...list].sort((a, b) => a.fund.localeCompare(b.fund) || byDate(b, a)); break;
      default: list = [...list].sort((a, b) => byDate(b, a)); break; // newest
    }
    return list;
  });

  /** Grouped for display — by fund when sorted "By fund", else by date. */
  readonly orderGroups = computed<OrderGroup[]>(() => {
    const byFund = this.txSort() === 'fund';
    const groups: OrderGroup[] = [];
    let cur: OrderGroup | null = null;
    for (const o of this.filteredOrders()) {
      const head = byFund ? o.fund : this.fmtDay(o.date);
      if (!cur || cur.head !== head) { cur = { head, rows: [] }; groups.push(cur); }
      cur.rows.push(o);
    }
    return groups;
  });

  /** Whether rows show the date inline (only when grouped by fund). */
  get groupedByFund(): boolean { return this.txSort() === 'fund'; }

  readonly putIn = computed(() =>
    this.orders().filter((o) => o.direction === 'in').reduce((s, o) => s + o.amount, 0));
  readonly paidOut = computed(() =>
    this.orders().filter((o) => o.direction === 'out').reduce((s, o) => s + o.amount, 0));
  /** Put-in fraction of the total flow, for the thin bar (0–100). */
  readonly putInPct = computed(() => {
    const total = this.putIn() + this.paidOut();
    return total > 0 ? Math.round((this.putIn() / total) * 100) : 100;
  });

  /** Count line: "N transactions" over the filtered set. */
  get shownLabel(): string {
    const n = this.filteredOrders().length;
    return `${n} transaction${n === 1 ? '' : 's'}`;
  }
  get sortLabel(): string {
    switch (this.txSort()) {
      case 'old': return 'Oldest first';
      case 'amt': return 'Largest first';
      case 'fund': return 'By fund';
      default: return 'Newest first';
    }
  }

  /** Subline for the "Transactions" account row: "N · last on 10 Sep". */
  get txSubline(): string {
    const list = this.orders();
    if (!list.length) return this.ordersLoaded() ? 'No transactions yet' : 'Loading…';
    const newest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
    return `${list.length} · last on ${this.fmtShort(newest.date)}`;
  }

  tagColour(tag: string): string { return TAG_COLOUR[tag] || 'var(--color-neutral-500)'; }
  money(v: number): string { return inr(v); }
  /** "+₹…" in gold for money received, plain "₹…" for money put in. */
  amountLabel(o: AccountOrder): string {
    return (o.direction === 'out' ? '+' : '') + inr(o.amount);
  }

  private fmtDay(iso: string): string { return this.fmt(iso, 'd MMM y'); }
  private fmtShort(iso: string): string { return this.fmt(iso, 'd MMM'); }
  /** Inline date shown on a row when grouped by fund ("10 Sep"). */
  fmtInline(iso: string): string { return this.fmtShort(iso); }
  private fmt(iso: string, pattern: string): string {
    if (!iso) return '';
    return this.datePipe.transform(iso, pattern) || iso;
  }

  downloadDone = signal(false);
  /** Statement download — a no-op for now (report generation is server-side). */
  onDownload(): void {
    this.downloadDone.set(true);
    setTimeout(() => this.downloadDone.set(false), 1800);
  }

  // ---- Personal details panel ----------------------------------------------
  /** Editable fields, prefilled from the client record (blank stays blank). */
  readonly fPhone = signal('');
  readonly fEmail = signal('');
  readonly fAddress = signal('');
  private prefilled = false;
  readonly meDirty = signal(false);
  readonly meSaved = signal(false);

  /** Prefill the editable fields once details arrive / the panel opens. */
  private prefill(): void {
    const d = this.details();
    if (!d || this.prefilled) return;
    this.fPhone.set(this.prettyPhone(d.phone || ''));
    this.fEmail.set(d.email || '');
    this.fAddress.set(d.address || '');
    this.prefilled = true;
  }

  onMeInput(): void { this.meDirty.set(true); this.meSaved.set(false); }

  openMe(): void {
    this.prefill();
    this.openPanel('me');
  }

  /** Save — a real personal-details PATCH is out of scope (the only /me/profile
   *  PATCH takes estate_name/city). For now: mirror the phone into the header +
   *  a "Saved ✓" confirmation. */
  onSave(): void {
    const phone = this.fPhone().trim();
    if (phone) {
      this.editedPhone.set(phone);
      this.est.setProfile({ phone });
    }
    this.meDirty.set(false);
    this.meSaved.set(true);
    setTimeout(() => this.meSaved.set(false), 2200);
  }

  /** "Client {code} · since {since}" — omits missing halves gracefully. */
  get meClientLine(): string {
    const d = this.details();
    const code = d?.client_code?.trim();
    const since = d?.since?.trim();
    const parts: string[] = [];
    if (code) parts.push(`Client ${code}`);
    if (since) {
      // format an ISO/date "since" as "Aug 2026"; leave free text as-is.
      const nice = this.fmt(since, 'MMM y');
      parts.push(`since ${nice || since}`);
    }
    return parts.join(' · ');
  }

  // ---- Update card ----------------------------------------------------------
  /** Version line: the app version if we have one, else the reference copy. */
  readonly appVersion = '';
  get updateSub(): string {
    return this.appVersion
      ? `${this.appVersion} · estate levels, payouts on the 1st`
      : 'estate levels, payouts on the 1st';
  }
  readonly updating = signal(false);
  readonly updated = signal(false);
  onUpdate(): void {
    if (this.updating() || this.updated()) return;
    this.updating.set(true);
    // Kick the real force-update (unregisters SW, clears caches, hard-reloads).
    // Show the "Up to date" done state after 1.4s regardless (the reload, when
    // it fires, supersedes it).
    try { void this.updater.forceUpdate(); } catch {}
    setTimeout(() => { this.updating.set(false); this.updated.set(true); }, 1400);
  }
}
