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
} from './admin.service';

type Phase = 'loading' | 'email' | 'otp' | 'setpin' | 'pin' | 'unlocked';

/** The one workspace has a small set of views, all about clients & money. */
type View = 'clients' | 'villas' | 'buckets' | 'uploads';

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
  nwSearch = signal('');
  nwSort = signal<'net_worth' | 'invested' | 'gain_pct' | 'name'>('net_worth');

  // client detail drawer
  nwDetail = signal<ClientNetWorth | null>(null);
  nwDetailLoading = signal(false);
  drawerTab = signal<'overview' | 'transactions' | 'mapping' | 'documents'>('overview');

  // villas & mapping (inside the drawer)
  mapCode = signal<string>('');
  mapTxns = signal<ClientTxn[]>([]);
  mapVillas = signal<ClientVilla[]>([]);
  mapSelected = signal<Set<string>>(new Set());
  mapLoading = signal(false);
  newVillaName = signal('');

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
    this.loadNetWorth();
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
  loadNetWorth(): void {
    this.nwLoading.set(true);
    this.api.reportToday().subscribe({ next: (t) => this.nwToday.set(t), error: () => {} });
    this.api.reportUploads().subscribe({ next: (u) => this.nwUploads.set(u), error: () => {} });
    this.api.reportClients().subscribe({
      next: (c) => { this.nwClients.set(c); this.nwLoading.set(false); },
      error: (e) => { this.nwLoading.set(false); if (e?.status === 401) this.lock(); },
    });
    this.api.reportBuckets().subscribe({ next: (b) => this.nwBuckets.set(b), error: () => {} });
  }

  onReportFile(type: 'user' | 'transaction', ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.nwError.set('');
    (type === 'user' ? this.nwUploadingUser : this.nwUploadingTxn).set(true);
    this.api.uploadReport(type, file).subscribe({
      next: () => {
        (type === 'user' ? this.nwUploadingUser : this.nwUploadingTxn).set(false);
        input.value = '';
        this.loadNetWorth();
      },
      error: (e) => {
        (type === 'user' ? this.nwUploadingUser : this.nwUploadingTxn).set(false);
        input.value = '';
        this.nwError.set(e?.error?.detail || 'Upload failed. Check the file format.');
      },
    });
  }

  setSort(s: 'net_worth' | 'invested' | 'gain_pct' | 'name'): void { this.nwSort.set(s); }

  // ── client detail drawer ────────────────────────────────────────────────────
  openNwClient(code: string): void {
    this.nwDetailLoading.set(true);
    this.nwDetail.set(null);
    this.drawerTab.set('overview');
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
      next: () => { this.loadMapping(this.mapCode()); this.mapSelected.set(new Set()); },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
  unassignSelected(): void {
    const ids = [...this.mapSelected()];
    if (!ids.length) return;
    this.api.unassignTxns(ids).subscribe({
      next: () => { this.loadMapping(this.mapCode()); this.mapSelected.set(new Set()); },
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
    this.api.deleteClientVilla(v.id).subscribe({
      next: () => this.loadMapping(this.mapCode()),
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }
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
