import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  AdminService,
  ClientDoc,
  ReportUpload,
  TodayStatus,
  NetWorthRow,
  ClientNetWorth,
  VillaBucket,
  VillaLive,
  BucketFund,
  CalDay,
  ClientTxn,
  ClientVilla,
  MappingOverview,
  PurchaseLine,
} from './admin.service';

/** One purchase = the transactions of one day and type (a ₹5L villa buy is
 *  4–5 fund lines on one day). It is pinned to a villa as a whole. */
interface Purchase {
  key: string; date: string; kind: string; total: number;
  txns: ClientTxn[];
  /** the villa every line is pinned to (null when unpinned or split) */
  villa: ClientVilla | null;
  /** lines pinned to different villas, or some pinned and some not */
  mixed: boolean;
  /** every line was added by hand (not yet in an AMC report) */
  manual: boolean;
  /** where it should go: a villa id, or 'new' */
  suggest: string;
}
const VILLA_FULL = 500_000;

type Phase = 'loading' | 'email' | 'otp' | 'setpin' | 'pin' | 'unlocked';

/** The one workspace has a small set of views, all about clients & money. */
type View = 'clients' | 'villas' | 'buckets' | 'uploads';
type DrawerTab = 'overview' | 'transactions' | 'mapping' | 'profile' | 'documents';

/** Villa colours, in fixed order by the villa's position (never by rank): the
 *  validated light categorical palette. Unmapped is NOT a colour from this list. */
const VILLA_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

/** One slice of a fund's money: the villa it went to (null = not mapped). */
interface FlowSeg { villaId: string | null; name: string; amount: number; pct: number; colour: string; count: number; }
/** A fund and where its transactions went. */
interface FundFlow { scheme: string; total: number; unmapped: number; segs: FlowSeg[]; }

/** The client master fields, in reading order, with plain labels. */
const PROFILE_FIELDS: [string, string][] = [
  ['name', 'Name'], ['client_code', 'Client code'], ['pan', 'PAN'], ['phone', 'Phone'],
  ['email', 'Email'], ['dob', 'Date of birth'], ['address', 'Address'], ['city', 'City'],
  ['state', 'State'], ['pin', 'PIN code'], ['signup', 'Signed up'], ['updated_at', 'Last updated from report'],
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private api = inject(AdminService);

  // ── auth state machine ─────────────────────────────────────────────────────
  phase = signal<Phase>('loading');
  busy = signal(false);
  authError = signal('');
  notice = signal('');
  signinEmail = signal('');
  maskedEmail = signal('');
  hasPin = signal(false);
  lockMinutes = signal(30);
  lockPresets = signal<number[]>([10, 30, 60, 120]);

  otpCode = signal('');
  pinInput = signal('');
  pin2Input = signal('');

  private exp = 0;
  private tick: any = null;
  secondsLeft = signal<number | null>(null);
  private lastRefresh = 0;
  private activityBound = false;

  // ── workspace ───────────────────────────────────────────────────────────────
  view = signal<View>('clients');
  setView(v: View): void {
    this.view.set(v);
    if (v === 'villas') this.loadVillasLive();
    if (v === 'buckets' && !this.nwBuckets().length) {
      this.api.reportBuckets().subscribe({ next: (b) => this.nwBuckets.set(b) });
    }
    if (v === 'uploads') this.loadCalendar();
  }

  // ── clients / net worth (the daily reports) ─────────────────────────────────
  nwToday = signal<TodayStatus | null>(null);
  nwUploads = signal<ReportUpload[]>([]);
  nwClients = signal<NetWorthRow[]>([]);
  nwLoading = signal(false);
  nwUploadingUser = signal(false);
  nwUploadingTxn = signal(false);
  nwError = signal('');
  /** short-lived success confirmation after an upload (auto-hides). */
  nwToast = signal<{ type: 'user' | 'transaction'; rows: number } | null>(null);
  private toastTimer: any = null;
  /** which slot is being dragged over (for the drop highlight). */
  dragOver = signal<'user' | 'transaction' | null>(null);
  nwSearch = signal('');
  nwSort = signal<'net_worth' | 'invested' | 'gain_pct' | 'name'>('net_worth');

  // client detail drawer
  nwDetail = signal<ClientNetWorth | null>(null);
  nwDetailLoading = signal(false);
  drawerTab = signal<DrawerTab>('overview');

  // villas & mapping (inside the drawer)
  mapCode = signal<string>('');
  mapTxns = signal<ClientTxn[]>([]);
  mapVillas = signal<ClientVilla[]>([]);
  mapSelected = signal<Set<string>>(new Set());
  mapLoading = signal(false);
  newVillaName = signal('');

  /** Transactions tab filter: all · unmapped · one villa (by id). */
  txnFilter = signal<string>('all');

  // ── mapping health (home alert) ─────────────────────────────────────────────
  mapOverview = signal<MappingOverview | null>(null);
  /** The client whose unmapped lines are expanded inside the home alert. */
  alertOpen = signal<string | null>(null);
  /** Refresh button state + when the home data was last pulled. */
  refreshing = signal(false);
  lastRefreshed = signal<Date | null>(null);

  // documents (inside the drawer) — keyed by client name
  drawerDocs = signal<ClientDoc[]>([]);
  docsLoading = signal(false);
  uploading = signal(false);
  docError = signal('');

  // villa live pricing + bucket builder
  nwVillas = signal<VillaLive[]>([]);
  nwBuckets = signal<VillaBucket[]>([]);

  // bucket builder draft
  newBucketName = signal('');
  newBucketTier = signal('');
  newBucketKind = signal<'sip' | 'lumpsum'>('sip');
  newBucketSubtitle = signal('');
  newBucketFunds = signal<BucketFund[]>([]);
  newFundName = signal('');
  bucketSaving = signal(false);
  showBuilder = signal(false);
  draftAllocTotal = computed(() =>
    this.newBucketFunds().reduce((s, f) => s + (Number(f.target_weight) || 0), 0));

  // upload-tracking calendar
  nwCalMonth = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  nwCalDays = signal<CalDay[]>([]);
  nwCalLoading = signal(false);
  nwCalSelected = signal<CalDay | null>(null);

  /** filtered + sorted client list. */
  nwFiltered = computed<NetWorthRow[]>(() => {
    const q = this.nwSearch().trim().toLowerCase();
    const sort = this.nwSort();
    let list = this.nwClients();
    if (q) {
      list = list.filter((c) => c.name.toLowerCase().includes(q) ||
        (c.phone || '').includes(q) || c.client_code.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      return (b[sort] || 0) - (a[sort] || 0);
    });
  });
  nwTotal = computed(() => this.nwClients().reduce((s, c) => s + (c.net_worth || 0), 0));
  nwTotalInvested = computed(() => this.nwClients().reduce((s, c) => s + (c.invested || 0), 0));
  nwTotalGain = computed(() => this.nwTotal() - this.nwTotalInvested());
  nwGainPct = computed(() => {
    const inv = this.nwTotalInvested();
    return inv ? (this.nwTotalGain() / inv) * 100 : 0;
  });
  /** true when both of today's reports are in — powers the freshness pill. */
  reportsFresh = computed(() => !!(this.nwToday()?.user && this.nwToday()?.transaction));

  ngOnInit(): void {
    this.initAuth();
  }

  // ═══════════════════════════ AUTH ═══════════════════════════
  private initAuth(): void {
    const now = Math.floor(Date.now() / 1000);
    const storedExp = this.api.storedExp;
    this.api.session().subscribe({
      next: (s) => {
        this.hasPin.set(!!s.has_pin);
        this.lockMinutes.set(s.lock_minutes || 30);
        this.lockPresets.set(s.lock_presets || this.lockPresets());
        if (s.email) this.maskedEmail.set(s.email);
        if (s.signin_email) this.signinEmail.set(s.signin_email);

        if (this.api.token && storedExp > now + 5 && s.device_known) {
          this.exp = storedExp;
          this.enterUnlocked();
          return;
        }
        this.api.clearToken();
        this.phase.set(s.device_known && s.has_pin ? 'pin' : 'email');
      },
      error: () => {
        this.phase.set('email');
      },
    });
  }

  sendCode(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.authError.set('');
    this.notice.set('');
    this.api.requestOtp('').subscribe({
      next: (r) => {
        this.maskedEmail.set(r.masked || this.signinEmail());
        this.notice.set(r.emailed ? '' : 'Dev mode: code printed to the server log.');
        this.phase.set('otp');
        this.busy.set(false);
      },
      error: (e) => {
        this.authError.set(e?.error?.detail || 'Could not send the code. Try again.');
        this.busy.set(false);
      },
    });
  }

  verifyCode(): void {
    const code = this.otpCode().trim();
    if (code.length < 6 || this.busy()) {
      if (code.length < 6) this.authError.set('Enter the 6-digit code.');
      return;
    }
    this.busy.set(true);
    this.authError.set('');
    this.api.verifyOtp('', code).subscribe({
      next: (r) => {
        this.api.store(r.access_token, r.expires_at);
        this.exp = r.expires_at;
        this.lockMinutes.set(r.lock_minutes || 30);
        this.lockPresets.set(r.lock_presets || this.lockPresets());
        this.hasPin.set(!!r.has_pin);
        if (r.email) this.maskedEmail.set(r.email);
        this.otpCode.set('');
        this.busy.set(false);
        if (r.has_pin) this.enterUnlocked();
        else this.phase.set('setpin');
      },
      error: (e) => {
        this.authError.set(e?.error?.detail || 'Incorrect or expired code.');
        this.busy.set(false);
      },
    });
  }

  createPin(): void {
    const p = this.pinInput().trim();
    if (!/^\d{4}$/.test(p)) { this.authError.set('PIN must be exactly 4 digits.'); return; }
    if (p !== this.pin2Input().trim()) { this.authError.set('The two PINs don’t match.'); return; }
    if (this.busy()) return;
    this.busy.set(true);
    this.authError.set('');
    this.api.setPin(p).subscribe({
      next: () => {
        this.hasPin.set(true);
        this.pinInput.set('');
        this.pin2Input.set('');
        this.busy.set(false);
        this.enterUnlocked();
      },
      error: (e) => {
        this.authError.set(e?.error?.detail || 'Could not set the PIN.');
        this.busy.set(false);
      },
    });
  }

  doUnlock(): void {
    const p = this.pinInput().trim();
    if (!p) { this.authError.set('Enter your PIN.'); return; }
    if (this.busy()) return;
    this.busy.set(true);
    this.authError.set('');
    this.api.unlock(p).subscribe({
      next: (r) => {
        this.api.store(r.access_token, r.expires_at);
        this.exp = r.expires_at;
        this.lockMinutes.set(r.lock_minutes || this.lockMinutes());
        this.pinInput.set('');
        this.busy.set(false);
        this.enterUnlocked();
      },
      error: (e) => {
        const detail = e?.error?.detail || 'Incorrect PIN.';
        this.authError.set(detail);
        this.busy.set(false);
        if (/email/i.test(detail)) { this.hasPin.set(false); this.phase.set('email'); }
      },
    });
  }

  useEmailInstead(): void {
    this.authError.set('');
    this.pinInput.set('');
    this.phase.set('email');
  }

  private enterUnlocked(): void {
    this.authError.set('');
    this.notice.set('');
    this.phase.set('unlocked');
    if (this.tick) clearInterval(this.tick);
    this.bindActivity();
    this.tick = setInterval(() => this.heartbeat(), 1000);
    this.heartbeat();
    this.refreshAll();
  }

  private bindActivity(): void {
    if (this.activityBound || typeof document === 'undefined') return;
    this.activityBound = true;
    const mark = () => this.maybeRefresh();
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach((ev) =>
      document.addEventListener(ev, mark, { passive: true }));
  }

  private maybeRefresh(): void {
    if (this.phase() !== 'unlocked') return;
    const now = Math.floor(Date.now() / 1000);
    const windowSec = this.lockMinutes() * 60;
    if (this.exp - now < windowSec / 2 && Date.now() - this.lastRefresh > 30_000) {
      this.slideToken();
    }
  }
  private slideToken(): void {
    this.lastRefresh = Date.now();
    this.api.refresh().subscribe({
      next: (r) => { this.api.store(r.access_token, r.expires_at); this.exp = r.expires_at; },
      error: () => this.lock(),
    });
  }

  private heartbeat(): void {
    if (this.phase() !== 'unlocked') return;
    const secsLeft = this.exp - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) { this.lock(); return; }
    this.secondsLeft.set(secsLeft);
  }

  lock(): void {
    this.api.clearToken();
    this.secondsLeft.set(null);
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    this.authError.set('');
    this.notice.set('');
    this.phase.set(this.hasPin() ? 'pin' : 'email');
  }

  signOut(): void {
    this.api.logoutDevice().subscribe({ next: () => {}, error: () => {} });
    this.api.clearToken();
    this.hasPin.set(false);
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    this.phase.set('email');
  }

  /** "Good morning / afternoon / evening" by the local clock. */
  greeting = computed<string>(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  });
  adminName = computed<string>(() => 'Ranjeev');
  todayLong = computed<string>(() => {
    const d = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${days[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}`;
  });

  lockCountdown = computed<string>(() => {
    const s = this.secondsLeft();
    if (s === null) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  });

  // ═══════════════════════════ CLIENTS / NET WORTH ═══════════════════════════
  /** The home Refresh button: re-pull everything the home screen shows (clients,
   *  live net worth, today's reports, mapping health) and the open view's data. */
  refreshAll(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    let pending = 2;
    const done = () => { if (--pending <= 0) { this.refreshing.set(false); this.lastRefreshed.set(new Date()); } };
    this.loadNetWorth(done);
    this.loadMappingOverview(done);
    if (this.view() === 'villas') this.loadVillasLive();
    if (this.view() === 'uploads') this.loadCalendar();
    if (this.mapCode()) this.loadMapping(this.mapCode());
  }
  refreshedLabel = computed(() => {
    const d = this.lastRefreshed();
    return d ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
  });

  loadMappingOverview(done?: () => void): void {
    this.api.mappingOverview().subscribe({
      next: (o) => { this.mapOverview.set(o); done?.(); },
      error: (e) => { done?.(); if (e?.status === 401) this.lock(); },
    });
  }
  /** Unmapped transaction count for a client row (0 when all mapped / none). */
  unmappedOf(code: string): number { return this.mapOverview()?.by_client?.[code]?.unmapped ?? 0; }
  toggleAlertClient(code: string): void { this.alertOpen.set(this.alertOpen() === code ? null : code); }

  loadNetWorth(done?: () => void): void {
    this.nwLoading.set(true);
    this.api.reportToday().subscribe({ next: (t) => this.nwToday.set(t), error: () => {} });
    this.api.reportUploads().subscribe({ next: (u) => this.nwUploads.set(u), error: () => {} });
    this.api.reportClients().subscribe({
      next: (c) => { this.nwClients.set(c); this.nwLoading.set(false); done?.(); },
      error: (e) => { this.nwLoading.set(false); done?.(); if (e?.status === 401) this.lock(); },
    });
    this.api.reportBuckets().subscribe({ next: (b) => this.nwBuckets.set(b), error: () => {} });
  }

  onReportFile(type: 'user' | 'transaction', ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadReportFile(type, file, () => { input.value = ''; });
  }

  /** Shared upload path used by the file picker AND drag-and-drop. Optimistic:
   *  shows the spinner immediately and a clear ✓ confirmation (with row count)
   *  the moment the server replies. */
  private uploadReportFile(type: 'user' | 'transaction', file: File, done?: () => void): void {
    this.nwError.set('');
    this.dragOver.set(null);
    (type === 'user' ? this.nwUploadingUser : this.nwUploadingTxn).set(true);
    this.api.uploadReport(type, file).subscribe({
      next: (r) => {
        (type === 'user' ? this.nwUploadingUser : this.nwUploadingTxn).set(false);
        done?.();
        this.showUploadToast(type, r?.row_count ?? 0);
        this.loadNetWorth();
        this.loadMappingOverview();
      },
      error: (e) => {
        (type === 'user' ? this.nwUploadingUser : this.nwUploadingTxn).set(false);
        done?.();
        if (e?.status === 401) { this.lock(); return; }
        this.nwError.set(e?.error?.detail || 'Upload failed. Check the file format.');
      },
    });
  }

  private showUploadToast(type: 'user' | 'transaction', rows: number): void {
    this.nwToast.set({ type, rows });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.nwToast.set(null), 4000);
  }
  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.nwToast.set(null);
  }

  // ── drag & drop ─────────────────────────────────────────────────────────────
  onDragOver(type: 'user' | 'transaction', ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    this.dragOver.set(type);
  }
  onDragLeave(type: 'user' | 'transaction', ev: DragEvent): void {
    ev.preventDefault();
    if (this.dragOver() === type) this.dragOver.set(null);
  }
  onDrop(type: 'user' | 'transaction', ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(null);
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    // light client-side guard so a wrong drop gives an instant, clear message
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const ok = type === 'user' ? ['xlsx', 'csv'] : ['csv'];
    if (!ok.includes(ext)) {
      this.nwError.set(`${type === 'user' ? 'User' : 'Transaction'} report must be a ${ok.map((e) => '.' + e).join(' or ')} file.`);
      return;
    }
    this.uploadReportFile(type, file);
  }

  setSort(s: 'net_worth' | 'invested' | 'gain_pct' | 'name'): void { this.nwSort.set(s); }

  // ── client detail drawer ────────────────────────────────────────────────────
  openNwClient(code: string, tab: DrawerTab = 'overview'): void {
    this.nwDetailLoading.set(true);
    this.nwDetail.set(null);
    this.drawerTab.set(tab);
    this.txnFilter.set('all');
    this.mapCode.set(code);
    this.drawerDocs.set([]);
    this.docError.set('');
    this.api.reportClientDetail(code).subscribe({
      next: (d) => {
        this.nwDetail.set(d);
        this.nwDetailLoading.set(false);
        this.loadDrawerDocs(d.client?.name || '');
      },
      error: (e) => { this.nwDetailLoading.set(false); if (e?.status === 401) this.lock(); },
    });
    this.loadMapping(code);
  }
  closeNwClient(): void {
    this.nwDetail.set(null);
    this.drawerTab.set('overview');
    this.mapCode.set('');
    this.mapTxns.set([]);
    this.mapVillas.set([]);
    this.mapSelected.set(new Set());
    this.drawerDocs.set([]);
  }

  /** clientName used for documents (docs are keyed by name). */
  private drawerClientName(): string { return this.nwDetail()?.client?.name || ''; }

  // ── villas & mapping ─────────────────────────────────────────────────────
  loadMapping(code: string): void {
    if (!code) return;
    this.mapLoading.set(true);
    this.api.clientTransactions(code).subscribe({
      next: (t) => this.mapTxns.set(t),
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
    this.api.clientVillas(code).subscribe({
      next: (v) => { this.mapVillas.set(v); this.mapLoading.set(false); },
      error: (e) => { this.mapLoading.set(false); if (e?.status === 401) this.lock(); },
    });
  }
  toggleTxn(orderId: string): void {
    const next = new Set(this.mapSelected());
    if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
    this.mapSelected.set(next);
  }
  assignSelectedTo(villaId: string): void {
    const ids = [...this.mapSelected()];
    if (!ids.length) return;
    this.api.assignTxns(villaId, ids).subscribe({
      next: () => { this.loadMapping(this.mapCode()); this.mapSelected.set(new Set()); this.loadMappingOverview(); },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  unassignSelected(): void {
    const ids = [...this.mapSelected()];
    if (!ids.length) return;
    this.api.unassignTxns(ids).subscribe({
      next: () => { this.loadMapping(this.mapCode()); this.mapSelected.set(new Set()); this.loadMappingOverview(); },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  addClientVilla(): void {
    const name = this.newVillaName().trim() || 'Villa';
    this.api.createClientVilla(this.mapCode(), name).subscribe({
      next: () => { this.loadMapping(this.mapCode()); this.newVillaName.set(''); },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  setVillaStatus(v: ClientVilla, status: 'building' | 'constructed'): void {
    this.api.updateClientVilla(v.id, { status }).subscribe({
      next: () => this.loadMapping(this.mapCode()),
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  toggleCoin(v: ClientVilla): void {
    this.api.updateClientVilla(v.id, { coin: !v.coin }).subscribe({
      next: () => this.loadMapping(this.mapCode()),
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  renameVilla(v: ClientVilla, name: string): void {
    const clean = (name || '').trim();
    if (!clean || clean === v.name) return;
    this.api.updateClientVilla(v.id, { name: clean }).subscribe({
      next: () => this.loadMapping(this.mapCode()),
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  removeVilla(v: ClientVilla): void {
    if (v.txn_count && !confirm(`Delete ${this.villaLabel(v)}? Its ${v.txn_count} transaction${v.txn_count === 1 ? '' : 's'} will be unpinned (not deleted).`)) return;
    this.api.deleteClientVilla(v.id).subscribe({
      next: () => { this.loadMapping(this.mapCode()); this.loadMappingOverview(); },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  // ── mapping, read back: what is mapped where ─────────────────────────────
  /** A villa's colour — by its position in the client's villa list. */
  villaColour(villaId: string | null): string {
    const i = this.mapVillas().findIndex((v) => v.id === villaId);
    return i < 0 ? '' : VILLA_COLOURS[i % VILLA_COLOURS.length];
  }
  /** The villa a transaction is mapped to (null when unmapped or its villa is gone). */
  villaFor(t: ClientTxn): ClientVilla | null {
    return t.villa_id ? (this.mapVillas().find((v) => v.id === t.villa_id) ?? null) : null;
  }
  mapUnmapped = computed<ClientTxn[]>(() => this.mapTxns().filter((t) => !this.villaFor(t)));
  mapUnmappedAmount = computed(() => this.mapUnmapped().reduce((s, t) => s + (t.amount || 0), 0));
  /** Mapping list order: unmapped first (they need action), then newest first. */
  mapTxnsSorted = computed<ClientTxn[]>(() => [...this.mapTxns()].sort((a, b) =>
    (this.villaFor(a) ? 1 : 0) - (this.villaFor(b) ? 1 : 0) || (b.txn_date || '').localeCompare(a.txn_date || '')));
  /** Transactions tab rows under the chosen filter. */
  txnsShown = computed<ClientTxn[]>(() => {
    const f = this.txnFilter();
    if (f === 'all') return this.mapTxns();
    if (f === 'unmapped') return this.mapUnmapped();
    return this.mapTxns().filter((t) => this.villaFor(t)?.id === f);
  });
  selectAllUnmapped(): void { this.mapSelected.set(new Set(this.mapUnmapped().map((t) => t.order_id))); }

  /** Every fund and where its money went: one bar per fund, one segment per villa
   *  (plus an "Not mapped" segment), sized by the ₹ of the transactions behind it. */
  fundFlow = computed<FundFlow[]>(() => {
    const byFund = new Map<string, Map<string | null, { amount: number; count: number }>>();
    for (const t of this.mapTxns()) {
      const vid = this.villaFor(t)?.id ?? null;
      const m = byFund.get(t.scheme_name) ?? new Map();
      const cur = m.get(vid) ?? { amount: 0, count: 0 };
      m.set(vid, { amount: cur.amount + (t.amount || 0), count: cur.count + 1 });
      byFund.set(t.scheme_name, m);
    }
    const order = (id: string | null) => id === null ? 999 : this.mapVillas().findIndex((v) => v.id === id);
    return [...byFund.entries()].map(([scheme, m]) => {
      const total = [...m.values()].reduce((s, x) => s + x.amount, 0);
      const segs = [...m.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([vid, x]) => ({
        villaId: vid,
        name: vid === null ? 'Not mapped' : (this.mapVillas().find((v) => v.id === vid)?.name || 'Villa'),
        amount: x.amount, count: x.count,
        pct: total > 0 ? (x.amount / total) * 100 : 0,
        colour: this.villaColour(vid),
      }));
      return { scheme, total, unmapped: m.get(null)?.amount ?? 0, segs };
    }).sort((a, b) => b.total - a.total);
  });

  /** The funds inside one villa (from its mapped transactions), biggest first. */
  villaFunds(v: ClientVilla): { scheme: string; amount: number; count: number; pct: number }[] {
    const m = new Map<string, { amount: number; count: number }>();
    for (const t of this.mapTxns()) {
      if (t.villa_id !== v.id) continue;
      const cur = m.get(t.scheme_name) ?? { amount: 0, count: 0 };
      m.set(t.scheme_name, { amount: cur.amount + (t.amount || 0), count: cur.count + 1 });
    }
    const total = [...m.values()].reduce((s, x) => s + x.amount, 0);
    return [...m.entries()].map(([scheme, x]) => ({ scheme, ...x, pct: total > 0 ? (x.amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }

  // ── purchases: pin a whole purchase to a villa in one tap ─────────────────
  /** The client's name for a villa — what their app shows (Villa 1, Plot 3). */
  villaLabel(v: ClientVilla): string {
    if (v.position === null || v.position === undefined) return 'Empty villa';
    return (v.finished ? 'Villa ' : 'Plot ') + (v.position + 1);
  }

  /** Transactions grouped into purchases (same day, same type), newest first. */
  purchases = computed<Purchase[]>(() => {
    const groups = new Map<string, ClientTxn[]>();
    for (const t of this.mapTxns()) {
      const kind = (t.kind || 'Purchase').trim();
      const key = `${(t.txn_date || '').slice(0, 10)}|${kind.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const out: Purchase[] = [];
    for (const [key, txns] of groups) {
      const ids = new Set(txns.map((t) => this.villaFor(t)?.id ?? null));
      const one = ids.size === 1 ? [...ids][0] : undefined;
      const villa = one ? this.mapVillas().find((v) => v.id === one) ?? null : null;
      const total = txns.reduce((s, t) => s + (t.amount || 0), 0);
      out.push({
        key, date: (txns[0].txn_date || '').slice(0, 10), kind: (txns[0].kind || 'Purchase').trim(), total, txns,
        villa, mixed: ids.size > 1, manual: txns.every((t) => this.isManual(t)), suggest: '',
      });
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    // suggestions, oldest first so the open plot fills in time order
    const room = new Map(this.mapVillas().map((v) => [v.id, v.finished ? 0 : VILLA_FULL - v.mapped_total]));
    for (const p of [...out].reverse()) {
      if (p.villa) continue;
      if (p.total >= VILLA_FULL * 0.99) { p.suggest = 'new'; continue; }
      const fit = this.mapVillas().find((v) => (room.get(v.id) ?? 0) >= p.total - 1);
      if (fit) { p.suggest = fit.id; room.set(fit.id, (room.get(fit.id) ?? 0) - p.total); }
      else p.suggest = 'new';
    }
    return out;
  });
  unpinnedPurchases = computed(() => this.purchases().filter((p) => !p.villa));
  unpinnedAmount = computed(() => this.unpinnedPurchases().reduce((s, p) => s + p.total, 0));
  suggestionLabel(p: Purchase): string {
    if (p.suggest === 'new') return p.total >= VILLA_FULL * 0.99 ? 'a new villa (it’s a full ₹5L)' : 'a new villa';
    const v = this.mapVillas().find((x) => x.id === p.suggest);
    return v ? `${this.villaLabel(v)} (still filling up)` : 'a new villa';
  }
  isManual(t: ClientTxn): boolean { return (t.order_id || '').startsWith('MAN-'); }

  openPurchase = signal<string | null>(null);
  togglePurchase(key: string): void { this.openPurchase.set(this.openPurchase() === key ? null : key); }
  /** the purchase whose pin is being saved (its row shows a spinner) */
  pinning = signal<string | null>(null);

  /** Pin every line of a purchase to a villa — or to a brand-new one. */
  pinPurchase(p: Purchase, target: string, done?: () => void): void {
    if (this.pinning() && !done) return;
    const ids = p.txns.map((t) => t.order_id);
    this.pinning.set(p.key);
    const finish = () => { this.pinning.set(null); done ? done() : this.afterMappingChange(); };
    const fail = (e: any) => { this.pinning.set(null); if (e?.status === 401) this.lock(); else this.flash('Couldn’t pin that purchase — try again'); };
    if (target === 'new') {
      const n = this.mapVillas().length + 1;
      this.api.createClientVilla(this.mapCode(), `Villa ${n}`).subscribe({
        next: (v) => this.api.assignTxns(v.id, ids).subscribe({ next: finish, error: fail }),
        error: fail,
      });
    } else {
      this.api.assignTxns(target, ids).subscribe({ next: finish, error: fail });
    }
  }
  unpinPurchase(p: Purchase): void {
    this.pinning.set(p.key);
    this.api.unassignTxns(p.txns.map((t) => t.order_id)).subscribe({
      next: () => { this.pinning.set(null); this.afterMappingChange(); },
      error: (e) => { this.pinning.set(null); if (e?.status === 401) this.lock(); },
    });
  }
  /** Pin every unpinned purchase where it's suggested, oldest first (so new villas
   *  are numbered in time order). Suggestions are recomputed after each pin. */
  pinAllSuggested(): void {
    const next = [...this.unpinnedPurchases()].sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!next) { this.afterMappingChange(); return; }
    this.pinPurchase(next, next.suggest || 'new', () => {
      // reload, then carry on with the rest
      this.api.clientTransactions(this.mapCode()).subscribe((t) => {
        this.mapTxns.set(t);
        this.api.clientVillas(this.mapCode()).subscribe((v) => { this.mapVillas.set(v); this.pinAllSuggested(); });
      });
    });
  }
  /** After any pin change: reload the drawer, the home alert and the KPIs. */
  private afterMappingChange(): void {
    this.loadMapping(this.mapCode());
    this.loadMappingOverview();
  }
  deleteManual(t: ClientTxn): void {
    if (!confirm(`Remove this hand-added line — ${t.scheme_name}, ${this.money(t.amount)}?`)) return;
    this.api.deleteManualTxn(t.order_id).subscribe({
      next: () => { this.afterMappingChange(); this.refreshDrawerKpis(); },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  private refreshDrawerKpis(): void {
    const code = this.mapCode();
    if (code) this.api.reportClientDetail(code).subscribe({ next: (d) => this.nwDetail.set(d), error: () => {} });
  }
  /** A short message in the corner. */
  flashMsg = signal('');
  private flashTimer: any = null;
  private flash(m: string): void {
    this.flashMsg.set(m);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashMsg.set(''), 2600);
  }

  // ── add a purchase by hand ─────────────────────────────────────────────────
  addOpen = signal(false);
  addDate = signal(new Date().toISOString().slice(0, 10));
  addKind = signal<'Lumpsum' | 'SIP'>('Lumpsum');
  addAmount = signal(500000);
  addFund = signal<string>('mix');                 // 'mix' or a scheme code
  addTarget = signal<string>('new');               // a villa id, or 'new'
  addLines = signal<PurchaseLine[]>([]);
  addMix = signal<{ scheme_code: number; scheme_name: string; weight: number }[]>([]);
  addLoading = signal(false);
  addErr = signal('');
  addSaving = signal(false);
  private previewTimer: any = null;

  openAdd(): void {
    this.addOpen.set(true);
    this.addErr.set('');
    this.addTarget.set(this.defaultTarget(this.addAmount()));
    this.previewSoon(0);
  }
  /** Where a new purchase of ₹amount should go: a full ₹5L → a new villa;
   *  otherwise the plot that's still filling up, if it has room. */
  private defaultTarget(amount: number): string {
    if (amount >= VILLA_FULL * 0.99) return 'new';
    const open = this.mapVillas().find((v) => !v.finished && v.mapped_total + amount <= VILLA_FULL * 1.01);
    return open ? open.id : 'new';
  }
  addAmountText(): string { return this.addAmount() ? this.addAmount().toLocaleString('en-IN') : ''; }
  onAddAmount(e: Event): void {
    const el = e.target as HTMLInputElement;
    const n = Number(el.value.replace(/[^\d]/g, '').slice(0, 10)) || 0;
    el.value = n ? n.toLocaleString('en-IN') : '';
    this.setAddAmount(n);
  }
  setAddAmount(n: number): void {
    this.addAmount.set(n);
    this.addTarget.set(this.defaultTarget(n));
    this.previewSoon();
  }
  /** Re-price the purchase (debounced while typing): each fund's ₹, NAV, units. */
  previewSoon(delay = 350): void {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      const amt = this.addAmount(), date = this.addDate();
      if (!(amt > 0) || !date) { this.addLines.set([]); return; }
      this.addLoading.set(true);
      this.addErr.set('');
      const fund = this.addFund() === 'mix' ? null : Number(this.addFund());
      this.api.purchasePreview(date, amt, fund).subscribe({
        next: (r) => {
          this.addLoading.set(false);
          this.addLines.set(r.lines || []);
          if (r.mix?.length) this.addMix.set(r.mix);
          if ((r.lines || []).some((l) => !l.nav)) this.addErr.set('No NAV found for that date yet — pick a date on or before the latest NAV.');
        },
        error: (e) => { this.addLoading.set(false); this.addErr.set('Couldn’t price that — check the date.'); if (e?.status === 401) this.lock(); },
      });
    }, delay);
  }
  canSaveAdd = computed(() => !this.addSaving() && !this.addLoading() && this.addAmount() > 0 &&
    this.addLines().length > 0 && this.addLines().every((l) => !!l.nav));
  addTargetLabel(): string {
    if (this.addTarget() === 'new') return 'a new villa';
    const v = this.mapVillas().find((x) => x.id === this.addTarget());
    return v ? this.villaLabel(v) : 'a new villa';
  }
  saveAdd(): void {
    if (!this.canSaveAdd()) return;
    this.addSaving.set(true);
    const target = this.addTarget();
    this.api.addPurchase(this.mapCode(), {
      date: this.addDate(), amount: this.addAmount(), kind: this.addKind(),
      scheme_code: this.addFund() === 'mix' ? null : Number(this.addFund()),
      villa_id: target === 'new' ? null : target, new_villa: target === 'new',
    }).subscribe({
      next: () => {
        this.addSaving.set(false);
        this.addOpen.set(false);
        this.flash(`Added ${this.money(this.addAmount())} and pinned it`);
        this.afterMappingChange();
        this.refreshDrawerKpis();
      },
      error: (e) => {
        this.addSaving.set(false);
        this.addErr.set(e?.error?.detail || 'Couldn’t save — try again.');
        if (e?.status === 401) this.lock();
      },
    });
  }
  addTotalUnits = computed(() => this.addLines().reduce((s, l) => s + (l.amount || 0), 0));

  /** Everything the User Report holds about this client, labelled, blanks kept
   *  visible as "—" so a missing PAN/email is noticed. Unknown columns follow. */
  profileRows = computed<{ label: string; value: string }[]>(() => {
    const c = this.nwDetail()?.client || {};
    const known = new Set(PROFILE_FIELDS.map(([k]) => k));
    const show = (k: string, v: any): string => {
      const raw = String(v ?? '').trim();
      if (k !== 'updated_at' || !raw) return raw;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? raw : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    };
    const rows = PROFILE_FIELDS.map(([k, label]) => ({ label, value: show(k, c[k]) }));
    for (const k of Object.keys(c)) {
      if (!known.has(k) && c[k] != null && typeof c[k] !== 'object') rows.push({ label: k.replace(/_/g, ' '), value: String(c[k]).trim() });
    }
    return rows;
  });

  villaOf(orderId: string): string | null {
    const txn = this.mapTxns().find((t) => t.order_id === orderId);
    if (!txn || !txn.villa_id) return null;
    const v = this.mapVillas().find((x) => x.id === txn.villa_id);
    return v ? v.name : null;
  }

  // ── documents (in the drawer) ───────────────────────────────────────────────
  loadDrawerDocs(name: string): void {
    if (!name) return;
    this.docsLoading.set(true);
    this.api.listDocuments(name).subscribe({
      next: (d) => { this.drawerDocs.set(d); this.docsLoading.set(false); },
      error: (e) => { this.docsLoading.set(false); if (e?.status === 401) this.lock(); },
    });
  }
  onDrawerFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    const name = this.drawerClientName();
    if (!file || !name) return;
    this.uploading.set(true);
    this.docError.set('');
    this.api.uploadDocument(name, file).subscribe({
      next: (doc) => {
        this.drawerDocs.update((list) => [doc, ...list]);
        this.uploading.set(false);
        input.value = '';
      },
      error: (e) => {
        this.docError.set(e?.error?.detail || 'Upload failed. Try again.');
        this.uploading.set(false);
        input.value = '';
      },
    });
  }
  openDoc(doc: ClientDoc): void {
    this.api.downloadDocument(doc.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => this.docError.set('Could not open that document.'),
    });
  }
  removeDoc(doc: ClientDoc): void {
    this.api.deleteDocument(doc.id).subscribe({
      next: () => this.drawerDocs.update((list) => list.filter((d) => d.id !== doc.id)),
      error: () => this.docError.set('Could not delete that document.'),
    });
  }

  // ── villa live pricing ──────────────────────────────────────────────────────
  loadVillasLive(): void {
    this.api.villasLive().subscribe({ next: (v) => this.nwVillas.set(v), error: () => {} });
  }
  villaLiveTotal(v: VillaLive): number {
    return v.funds.reduce((s, f) => s + (f.nav || 0), 0);
  }

  // ── bucket builder ──────────────────────────────────────────────────────────
  addFundToBucket(): void {
    const name = this.newFundName().trim();
    if (!name) return;
    this.newBucketFunds.update((f) => [...f, {
      scheme_name: name, category: 'Equity', sleeve: this.guessSleeve(name), target_weight: 0,
      ret_1y: null, ret_3y: null, ret_5y: null,
    }]);
    this.newFundName.set('');
  }
  editDraftFund(i: number, field: keyof BucketFund, value: any): void {
    this.newBucketFunds.update((funds) =>
      funds.map((f, idx) => {
        if (idx !== i) return f;
        const num = value === '' || value === null ? null : Number(value);
        if (field === 'scheme_name' || field === 'category' || field === 'sleeve') return { ...f, [field]: value };
        return { ...f, [field]: num };
      }));
  }
  sleeveLabel(s?: string): string {
    return ({ arbitrage: 'Arbitrage', gold: 'Gold', large: 'Large Cap',
              mid: 'Mid Cap', small: 'Small Cap', other: 'Other' } as Record<string, string>)[s || ''] || '';
  }
  guessSleeve(name: string): string {
    const n = (name || '').toLowerCase();
    if (n.includes('arbitrage')) return 'arbitrage';
    if (n.includes('gold')) return 'gold';
    if (n.includes('small')) return 'small';
    if (n.includes('mid')) return 'mid';
    if (n.includes('large') || n.includes('momentum') || n.includes('flexi') || n.includes('index')) return 'large';
    return 'other';
  }
  removeFundFromBucket(i: number): void {
    this.newBucketFunds.update((f) => f.filter((_, idx) => idx !== i));
  }
  weightedReturn(funds: BucketFund[], key: 'ret_1y' | 'ret_3y' | 'ret_5y'): number | null {
    let wsum = 0, acc = 0;
    for (const f of funds) {
      const r = f[key];
      if (r === null || r === undefined || isNaN(Number(r))) continue;
      const w = Number(f.target_weight) || 0;
      wsum += w; acc += w * Number(r);
    }
    if (wsum <= 0) return null;
    return acc / wsum;
  }
  bucketAllocTotal(funds: BucketFund[]): number {
    return funds.reduce((s, f) => s + (Number(f.target_weight) || 0), 0);
  }
  saveBucket(): void {
    const name = this.newBucketName().trim();
    if (!name || !this.newBucketFunds().length) return;
    this.bucketSaving.set(true);
    this.api.createBucket({
      name, tier: this.newBucketTier().trim() || undefined,
      kind: this.newBucketKind(), subtitle: this.newBucketSubtitle().trim() || undefined,
      funds: this.newBucketFunds(),
    }).subscribe({
      next: () => {
        this.bucketSaving.set(false);
        this.newBucketName.set(''); this.newBucketTier.set('');
        this.newBucketKind.set('sip'); this.newBucketSubtitle.set('');
        this.newBucketFunds.set([]);
        this.showBuilder.set(false);
        this.api.reportBuckets().subscribe({ next: (b) => this.nwBuckets.set(b) });
      },
      error: () => this.bucketSaving.set(false),
    });
  }
  removeBucket(id: string): void {
    this.api.deleteBucket(id).subscribe({
      next: () => this.nwBuckets.update((b) => b.filter((x) => x.id !== id)),
    });
  }

  // ── upload-tracking calendar ─────────────────────────────────────────────
  private fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  loadCalendar(): void {
    const month = this.nwCalMonth();
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    this.nwCalLoading.set(true);
    this.nwCalSelected.set(null);
    this.api.reportCalendar(this.fmtDate(start), this.fmtDate(end)).subscribe({
      next: (d) => { this.nwCalDays.set(d); this.nwCalLoading.set(false); },
      error: (e) => { this.nwCalLoading.set(false); if (e?.status === 401) this.lock(); },
    });
  }
  calPrevMonth(): void {
    const m = this.nwCalMonth();
    this.nwCalMonth.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
    this.loadCalendar();
  }
  calNextMonth(): void {
    const m = this.nwCalMonth();
    this.nwCalMonth.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
    this.loadCalendar();
  }
  calMonthLabel = computed(() =>
    this.nwCalMonth().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
  calLeadPad = computed(() => {
    const m = this.nwCalMonth();
    return new Array(new Date(m.getFullYear(), m.getMonth(), 1).getDay()).fill(0);
  });
  calDayNum(d: CalDay): number { return Number(d.date.slice(8, 10)); }
  calIsFuture(d: CalDay): boolean { return d.date > this.fmtDate(new Date()); }
  calIsToday(d: CalDay): boolean { return d.date === this.fmtDate(new Date()); }
  selectCalDay(d: CalDay): void {
    this.nwCalSelected.set(this.nwCalSelected()?.date === d.date ? null : d);
  }
  calComplete = computed(() => {
    const today = this.fmtDate(new Date());
    const elapsed = this.nwCalDays().filter((d) => d.date <= today);
    return { done: elapsed.filter((d) => d.status === 'both').length, total: elapsed.length };
  });

  // ═══════════════════════════ helpers ═══════════════════════════
  fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  money(v: number): string {
    if (v == null) return '₹0';
    const neg = v < 0;
    const a = Math.abs(v);
    let out: string;
    if (a >= 1_00_00_000) out = `₹${(a / 1_00_00_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
    else if (a >= 1_00_000) out = `₹${(a / 1_00_000).toFixed(1).replace(/\.0$/, '')} L`;
    else out = `₹${Math.round(a).toLocaleString('en-IN')}`;
    return neg ? `−${out}` : out;
  }
  pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%`; }
  initials(name: string): string {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }
}
