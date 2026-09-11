import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';

import { AuthService } from './auth/auth.service';
import { Booking, BookingService } from './booking.service';
import { CallScheduleComponent } from './shared/call-schedule.component';
import { CallsService } from './shared/calls.service';
import { VillaArtComponent } from './shared/villa-art.component';
import { LandArtComponent } from './shared/land-art.component';
import { EstateService, FundsBreakdown, Tile, TileType, Variant } from './estate.service';
import { Cell, buildCells, gridSize } from './estate/board-layout';
import { compact, inr } from './shared/format.util';

/** One parcel of the fixed 3x3 reference board. */
interface BoardCell {
  col: number;
  row: number;
  /** Offset for the tile <use>, per the reference placement formula. */
  x: number;
  y: number;
  /** The owned asset here, or null for an empty (locked) lot. */
  tile: Tile | null;
  /** Which reference symbol paints the ground (#tVilla / #tLand / #tLocked). */
  use: string;
  /** True when a construction shell (#tBuild) stands on the land. */
  building: boolean;
}

/** Ticket price for one parcel; villas and builds are multiples of it. */
const PLOT_TICKET = 10_00_000;

/**
 * The estate home screen.
 *
 * The board is the "estate board" reference: one 2:1 isometric diamond grid
 * whose parcels are painted with three interchangeable SVG symbols —
 * #tLocked (open tile), #tLand (bare land / building base) and #tVilla
 * (finished villa). The heavy hand-drawn hall/villa geometry is gone; each
 * cell is now a single <use> plus, for a build in progress, one construction
 * group. The board is a FIXED 3x3 (the reference "estate board") — no pan/zoom.
 */
@Component({
  selector: 'app-estate-home',
  standalone: true,
  imports: [CommonModule, FormsModule, CallScheduleComponent, VillaArtComponent, LandArtComponent],
  templateUrl: './estate-home.component.html',
  styleUrl: './estate-home.component.scss',
})
export class EstateHomeComponent implements OnInit {
  /** Hidden file picker behind the corner avatar. */
  @ViewChild('photoInput') photoInput?: ElementRef<HTMLInputElement>;

  /** Play the "verified" tick once, right after OTP (passed by the shell). */
  @Input() justVerified = false;

  /** Tapping a built tile asks the shell to open its detail page. */
  @Output() openTile = new EventEmitter<Tile>();
  @Output() explore = new EventEmitter<void>();
  @Output() progress = new EventEmitter<void>();
  /** "Build a new asset" -> open the villa/land pick screen. */
  @Output() build = new EventEmitter<void>();
  /** The corner avatar -> open the account page. */
  @Output() account = new EventEmitter<void>();
  /** Ask the shell to re-sync the estate (advisor may have assigned a villa). */
  @Output() refresh = new EventEmitter<void>();

  readonly est = inject(EstateService);
  private readonly callsSvc = inject(CallsService);
  private readonly bookingSvc = inject(BookingService);
  private readonly auth = inject(AuthService);

  // ── the setup call (empty estate): show the upcoming booked call on the map,
  //    and let a brand-new user book one right from here. ──
  /** The user's next upcoming consultation, read from the shared DB. */
  upcomingCall = signal<Booking | null>(null);
  /** The verified-tick overlay, shown once right after OTP. */
  showTick = signal(false);
  /** Book-a-setup-call sheet (empty-estate flow). */
  callSheetOpen = signal(false);
  callDays = signal<{ iso: string; label: string; slots: { label: string; slot: string }[] }[]>([]);
  callDaysLoading = signal(false);
  callSlotIso = signal<string | null>(null);
  callSlotLabel = signal('');
  callSubmitting = signal(false);
  callError = signal('');

  /** Buy sheet state: the open plot being filled, or null. */
  buying = signal<Cell | null>(null);

  // -- buying requires booking a fund-manager call; the user cannot create a
  //    plot themselves. The chosen type + a small calendar flow live here. --
  /** The asset type the user has asked to build (drives the call topic). */
  requestType = signal<TileType | null>(null);
  /** Book-a-call step: 1 pick date · 2 pick time · 3 request sent. */
  bkStep = signal(1);
  bkMonth = signal(this.firstOfMonth());
  bkDay = signal<Date | null>(null);
  bkSlot = signal<string | null>(null);
  bkSent = signal(false);
  readonly BK_SLOTS = ['10:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '5:00 PM'];

  private firstOfMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  private typeWord(t: TileType): string {
    return t === 'villa' ? 'Villa' : t === 'building' ? 'Villa (SIP build)' : 'Land';
  }
  /** The chosen type as a word, for the template. */
  typeWordFor(): string {
    const t = this.requestType();
    return t ? this.typeWord(t) : 'asset';
  }
  /** Detail popup state: the tapped cell (owned tile or open plot), or null. */
  selected = signal<Cell | null>(null);
  /** The "what your estate means" key — closed by default, opens on the ? tap. */
  keyOpen = signal(false);
  toggleKey(): void { this.keyOpen.update((v) => !v); if (navigator.vibrate) navigator.vibrate(4); }

  /** The user's fund-by-fund breakdown (from GET /me/funds) — drives the
   *  PORTFOLIO VALUE allocation bar at the bottom of the home screen. Null until
   *  it loads (or when signed out / offline), so the bar is gated on it. */
  funds = signal<FundsBreakdown | null>(null);
  /** Instant fund allocation (name/category/allocation) for the PORTFOLIO bar. */
  alloc = signal<{ name: string; scheme_code?: number; category: string; allocation: number }[]>([]);

  // ── settings sheet: edit the estate name + city (server-backed) ──
  /** Whether the estate-settings sheet is open. */
  settingsOpen = signal(false);
  /** Draft values while the sheet is open (seeded from the server on open). */
  draftName = signal('');
  draftCity = signal('');
  /** ngModel bridges for the two inputs (two-way binding into the signals). */
  get draftNameModel(): string { return this.draftName(); }
  set draftNameModel(v: string) { this.draftName.set(v); }
  get draftCityModel(): string { return this.draftCity(); }
  set draftCityModel(v: string) { this.draftCity.set(v); }

  /** Open the settings sheet, seeding the drafts with the server values. */
  openSettings(): void {
    this.draftName.set(this.est.estateName);
    this.draftCity.set(this.est.estateCity);
    this.settingsOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  closeSettings(): void { this.settingsOpen.set(false); }
  /** Save the drafts (empty clears back to the server default) and close. */
  saveSettings(): void {
    this.est.saveEstateProfile({
      estate_name: this.draftName().trim(),
      estate_city: this.draftCity().trim(),
    });
    this.closeSettings();
    if (navigator.vibrate) navigator.vibrate(4);
  }
  /** Today, for the date line. */
  today = new Date();
  /** Open plots shown in the legend — the immediate ring around the town, not
   *  the whole 120-plot board, so it reads clean (e.g. "3 open"). */
  get openShown(): number { return Math.min(this.open, Math.max(3, this.villas + this.buildings)); }
  /** Every finished villa wears a decorative ₹ coin. */
  wearsCoin(c: Cell): boolean {
    return !!c.tile && c.tile.type === 'villa';
  }
  /** The right-hand figure has two faces: monthly rent (default) and build
   *  cost. Tapping morphs between them in place. */
  showBuildCost = signal(false);
  toggleRentFace(): void { this.showBuildCost.update((v) => !v); }

  /** Which figure's risk tip is open ('worth' | 'rent' | null). */
  tip = signal<string | null>(null);
  toggleTip(k: string, ev?: Event): void {
    ev?.stopPropagation();
    this.tip.update((t) => (t === k ? null : k));
  }

  /** "View more details" reveals the build + assets panel below the first
   *  screen; tapping it also scrolls that panel into view. */
  showMore = signal(false);
  toggleMore(): void {
    const opening = !this.showMore();
    this.showMore.set(opening);
    if (opening) {
      // let the panel render, then bring it into view
      setTimeout(() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' }), 60);
    }
  }

  // -------------------------------------------------------- owner photo ----

  /** Open the OS photo picker (fired from the corner avatar). */
  pickPhoto(): void {
    this.photoInput?.nativeElement.click();
  }

  /** Read the chosen image as a data URL and store it on the profile so it
   *  persists and shows in the corner avatar. */
  onPhotoChosen(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const photo = typeof reader.result === 'string' ? reader.result : undefined;
      if (photo) this.est.setProfile({ photo });
    };
    reader.readAsDataURL(file);
    input.value = ''; // allow re-picking the same file later
  }

  // -------------------------------------------------------------- board ----
  // The reference is a FIXED 3x3 isometric board (no pan/zoom). Each of the
  // nine cells is placed with the reference's exact formula:
  //   offsetX = (col - row) * 93.6 ;  offsetY = (col + row) * 54
  // and cells are painted in ascending (col + row) so back tiles paint over
  // front tiles (SVG has no z-buffer — document order IS depth).

  get grid(): number { return gridSize(this.est.tiles().length); }

  /** Every cell, owned tiles assigned and sorted back-to-front for painting.
   *  Still used by the empty-state centre + the metaphor-key previews. */
  cells = computed<Cell[]>(() => buildCells(this.est.tiles()));

  /** One rendered parcel of the fixed 3x3 reference board. */
  // (kept small + local — this is the only geometry the static board needs.)
  boardCells = computed<BoardCell[]>(() => {
    // The user's real assets, most-established first (villas before builds
    // before land), so the finished villas land on the front-most parcels.
    const tiles = this.est.tiles();
    const order: TileType[] = ['villa', 'building', 'land'];
    const owned = [...tiles].sort(
      (a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.boughtAt - b.boughtAt,
    );

    // The nine 3x3 parcels, front-most (largest col+row) filled FIRST so the
    // owner's tiles cluster at the front of the board and empty lots recede.
    const coords: { col: number; row: number }[] = [];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) coords.push({ col, row });
    const byFrontFirst = [...coords].sort((a, b) => (b.col + b.row) - (a.col + a.row));

    const assigned = new Map<string, Tile>();
    byFrontFirst.forEach(({ col, row }, i) => {
      const t = owned[i];
      if (t) assigned.set(`${col},${row}`, t);
    });

    // Emit sorted back-to-front (ascending col+row) so depth reads right.
    return coords
      .map(({ col, row }) => {
        const tile = assigned.get(`${col},${row}`) ?? null;
        const use = !tile
          ? '#tLocked'
          : tile.type === 'villa'
            ? '#tVilla'
            : '#tLand'; // land AND building stand on bare land
        return {
          col,
          row,
          x: (col - row) * 93.6,
          y: (col + row) * 54,
          tile,
          use,
          building: tile?.type === 'building',
        } as BoardCell;
      })
      .sort((a, b) => (a.col + a.row) - (b.col + b.row));
  });

  /** True once at least one finished villa exists — the gold coin bobs above
   *  the front-most villa only when one is really there. */
  boardCoin = computed<BoardCell | null>(() => {
    const villas = this.boardCells().filter((c) => c.tile?.type === 'villa');
    if (!villas.length) return null;
    // front-most villa (largest col+row) wears the coin
    return villas.reduce((a, b) => ((b.col + b.row) >= (a.col + a.row) ? b : a));
  });

  /** Tapping an owned parcel opens its detail page (via the shell). Empty /
   *  locked parcels are inert. */
  tapBoardCell(c: BoardCell): void {
    if (!c.tile) return;
    if (navigator.vibrate) navigator.vibrate(4);
    this.openTile.emit(c.tile);
  }

  /** Transform placing the reference construction group (#tBuild) on a cell.
   *  #tBuild is authored around (640,430) in its own space; re-anchor it to the
   *  cell centre and scale to sit on the land tile. */
  boardBuildTransform(c: BoardCell): string {
    return `translate(${c.x + 120},${c.y + 100}) scale(0.32) translate(-640,-430)`;
  }

  /** True when the user owns nothing yet — the whole estate is open plots, so
   *  we don't paint the founding villa in the centre (an empty ₹0 estate should
   *  look genuinely empty and invite the first purchase). */
  // NOTE: deliberately a plain getter, NOT a computed(). A memoized computed
  // was getting stuck "true" under the production build (its dependency on the
  // portfolio signal wasn't re-triggering a re-render), so a user with real
  // holdings but no estate tiles kept seeing the "Book your setup call"
  // onboarding. A getter is re-evaluated every change-detection cycle — exactly
  // like the estateName binding right next to it — so it can never lag the data.
  get isEmptyEstate(): boolean {
    // Truly empty ONLY for a user with no holdings at all. A registered user who
    // has invested (server says has_holdings, or invested/worth > 0) is NEVER
    // shown the "book your setup call" onboarding — even before /me/estate tiles
    // arrive — so the map and the CTA can't contradict each other.
    if (this.est.tiles().length > 0) return false;
    const p = this.est.portfolio();
    if (p && (p.has_holdings || p.invested > 0 || p.worth > 0)) return false;
    // Don't guess before we know: until the first /me/portfolio response lands,
    // assume NOT empty so a holder never gets a flash of the setup-call CTA.
    if (!this.est.portfolioLoaded()) return false;
    return true;
  }

  // ------------------------------------------------------------ lifecycle --

  ngOnInit(): void {
    // Play the verified tick once, right after OTP.
    if (this.justVerified) {
      this.showTick.set(true);
      setTimeout(() => this.showTick.set(false), 1900);
    }
    // Load any upcoming setup call so an empty estate can show it.
    this.loadUpcomingCall();
    // Load the fund allocation for the PORTFOLIO VALUE bar — the INSTANT endpoint
    // (name/category/allocation only); ₹ values are derived from the portfolio
    // value on the fly, so the bar appears immediately, not after a slow fetch.
    this.est.allocation().subscribe({
      next: (a) => this.alloc.set(a.funds || []),
      error: () => { /* signed out / offline — the bar stays hidden */ },
    });
  }

  // ── setup call (shown when the estate is empty) ─────────────────────────────
  private loadUpcomingCall(): void {
    const phone = this.auth.user()?.phone || '';
    if (!phone) return;
    this.bookingSvc.mine(phone).subscribe({
      next: (list) => {
        const now = Date.now();
        const next = (list || [])
          .filter((b) => b.kind === 'consultation' && b.status !== 'declined' && b.slot)
          .filter((b) => new Date(b.slot!).getTime() > now - 3 * 3600_000)
          .sort((a, b) => new Date(a.slot!).getTime() - new Date(b.slot!).getTime())[0] || null;
        this.upcomingCall.set(next);
      },
      error: () => {},
    });
  }

  /** Pretty date/time for the upcoming-call chip. */
  get callWhen(): { day: string; time: string } | null {
    const iso = this.upcomingCall()?.slot;
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const h = d.getHours(), m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return {
      day: `${wk[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}`,
      time: m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`,
    };
  }
  get callConfirmed(): boolean { return this.upcomingCall()?.status === 'confirmed'; }

  openCallSheet(): void {
    this.callSlotIso.set(null); this.callSlotLabel.set(''); this.callError.set('');
    this.callSheetOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
    this.loadCallDays();
  }
  closeCallSheet(): void { this.callSheetOpen.set(false); }
  private loadCallDays(): void {
    this.callDaysLoading.set(true);
    this.callDays.set([]);
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    this.bookingSvc.freeDays(4).subscribe({
      next: (r) => {
        this.callDays.set((r.days || []).map((day) => {
          const [y, m, d] = day.date.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          return {
            iso: day.date,
            label: `${wk[dt.getDay()]}, ${dt.getDate()} ${mo[dt.getMonth()]}`,
            slots: (day.slots || []).map((s) => ({ label: this.callSlotLabelFor(s.time), slot: s.slot })),
          };
        }));
        this.callDaysLoading.set(false);
      },
      error: () => { this.callDays.set([]); this.callDaysLoading.set(false); },
    });
  }
  private callSlotLabelFor(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }
  callPick(dayLabel: string, s: { label: string; slot: string }): void {
    this.callSlotIso.set(s.slot);
    this.callSlotLabel.set(`${dayLabel} · ${s.label}`);
    this.callError.set('');
    if (navigator.vibrate) navigator.vibrate(4);
  }
  callIsSlot(s: { slot: string }): boolean { return this.callSlotIso() === s.slot; }
  callConfirm(): void {
    if (this.callSubmitting() || !this.callSlotIso()) return;
    const u = this.auth.user();
    const name = (u?.name || '').trim() || 'New client';
    const phone = (u?.phone || '').replace(/\D/g, '').slice(-10);
    this.callSubmitting.set(true);
    this.callError.set('');
    this.bookingSvc.createBooking({
      name, phone, kind: 'consultation', property: 'villa', variant: 'balanced',
      slot: this.callSlotIso()!, note: 'Account setup · risk profile & first villa',
    }).subscribe({
      next: (b) => {
        this.callSubmitting.set(false);
        this.upcomingCall.set(b);
        this.callSheetOpen.set(false);
        if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
        setTimeout(() => this.loadUpcomingCall(), 400);
      },
      error: () => { this.callSubmitting.set(false); this.callError.set('Could not book that slot. Please try again.'); },
    });
  }

  // ---------------------------------------------------------- interaction --

  /** Open the detail popup for a cell (used by the empty-state / key previews). */
  tapCell(c: Cell): void {
    if (navigator.vibrate) navigator.vibrate(4);
    this.selected.set(c);
  }

  /** Close the detail popup. */
  closeDetail(): void {
    this.selected.set(null);
  }

  /** From the detail popup: open the full detail page for this tile. */
  openFull(t: Tile): void {
    this.selected.set(null);
    this.openTile.emit(t);
  }

  /** From an open-plot popup: switch to the build chooser. */
  startBuild(c: Cell): void {
    this.selected.set(null);
    this.buying.set(c);
  }

  /** First-time empty state: open the buy sheet on the first open plot (the
   *  one nearest the hall), so a new user goes straight into buying. */
  buildFirst(): void {
    const first = this.cells().find((c) => !c.hall && !c.tile);
    if (first) this.buying.set(first);
    if (navigator.vibrate) navigator.vibrate(6);
  }

  // -------- detail popup: the numbers the card shows --------

  /** 1-based plot number, matching the fill order. */
  plotNo(c: Cell): number { return c.index + 1; }

  /** Which estate-board symbol the popup preview should <use> — the SAME
   *  symbols the map paints with, so the preview matches the tile exactly.
   *  A building stands on bare land (with #tBuild layered on top). */
  popSymbol(c: Cell): string {
    const t = c.tile;
    if (!t) return '#tLocked';
    if (t.type === 'villa') return '#tVilla';
    return '#tLand';
  }

  /** Which estate-board symbol a given owned tile shows in the asset log. */
  tileSymbol(t: Tile): string {
    return t.type === 'villa' ? '#tVilla' : '#tLand';
  }

  /** Every asset the user owns, newest purchase first — the log rows.
   *  Just the real tiles now; there is no fake "founding" villa. */
  get ownedLog(): Tile[] {
    return [...this.est.tiles()].sort((a, b) => b.boughtAt - a.boughtAt);
  }

  /** Build progress as "<accrued-months> of <target-months>", reference-style. */
  buildStep(t: Tile): { done: number; total: number } {
    const total = t.sipMonthly > 0 ? Math.round(t.cost / t.sipMonthly) : 60;
    const done = t.sipMonthly > 0 ? Math.round(t.sipAccrued / t.sipMonthly) : 0;
    return { done: Math.min(done, total), total };
  }

  buildPct(t: Tile): number {
    const { done, total } = this.buildStep(t);
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  /** Whole months left until a building finishes and becomes a villa. */
  monthsLeft(t: Tile): number {
    const { done, total } = this.buildStep(t);
    return Math.max(0, total - done);
  }

  /** Days left until a building completes (~30 days per remaining month). */
  daysLeft(t: Tile): number {
    return this.monthsLeft(t) * 30;
  }

  /** The date the building is expected to finish. */
  completesOn(t: Tile): Date {
    return new Date(Date.now() + this.daysLeft(t) * 86_400_000);
  }

  /** The monthly rent a building will pay once it's finished (~6%/yr of cost),
   *  matching how a villa's rent is set when it's created. */
  futureRent(t: Tile): number {
    return Math.round((t.cost * 0.06) / 12);
  }

  /** Representative annual growth (CAGR) for a land plot — a pure equity
   *  basket. Fixed rate so the number is stable per session. */
  private readonly LAND_CAGR = 0.12;
  landCagrPct(): number {
    return Math.round(this.LAND_CAGR * 100);
  }

  // -------- investment numbers for the detail popup --------
  /** How much has actually gone in so far (SIP accrued for a build; full cost
   *  once it's a finished villa/land). */
  investedSoFar(t: Tile): number {
    return t.type === 'building' ? t.sipAccrued : t.cost;
  }
  /** How much is still to go before the villa is fully owned. */
  remaining(t: Tile): number {
    return Math.max(0, t.cost - this.investedSoFar(t));
  }
  /** A land plot's value today, its cost grown at the CAGR since purchase. */
  landValue(t: Tile): number {
    // Clamp the holding period to a sane 0–5 years so a bad boughtAt (0/1970,
    // future) can never compound into an absurd value.
    const raw = (Date.now() - t.boughtAt) / (365.25 * 86_400_000);
    const years = Math.min(5, Math.max(0, Number.isFinite(raw) ? raw : 0));
    return Math.round(t.cost * Math.pow(1 + this.LAND_CAGR, years));
  }

  /** The user picked what to build. They cannot create it themselves — this
   *  opens the fund-manager call booking. The plot appears only after the
   *  manager approves the request; booking the call sends the request. */
  buy(type: TileType, _variant: Variant): void {
    this.requestType.set(type);
    this.bkStep.set(1);
    this.bkMonth.set(this.firstOfMonth());
    this.bkDay.set(null);
    this.bkSlot.set(null);
    this.bkSent.set(false);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  cancelBuy(): void {
    this.buying.set(null);
    this.requestType.set(null);
  }

  // ---- book-a-call calendar (buying) ----
  get bkMonthLabel(): string {
    return this.bkMonth().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  get bkCells(): (Date | null)[] {
    const m = this.bkMonth();
    const y = m.getFullYear(), mon = m.getMonth();
    const lead = new Date(y, mon, 1).getDay();
    const days = new Date(y, mon + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(y, mon, d));
    return cells;
  }
  get bkCanPrev(): boolean { return this.bkMonth() > this.firstOfMonth(); }
  bkPrevMonth(): void {
    if (!this.bkCanPrev) return;
    const m = this.bkMonth();
    this.bkMonth.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  bkNextMonth(): void {
    const m = this.bkMonth();
    this.bkMonth.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  bkSelectable(dt: Date): boolean {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) return false;
    const min = new Date(); min.setHours(0, 0, 0, 0); min.setDate(min.getDate() + 2);
    return dt.getTime() >= min.getTime();
  }
  bkIsDay(dt: Date): boolean {
    const d = this.bkDay();
    return !!d && d.getTime() === dt.getTime();
  }
  bkPickDay(dt: Date): void {
    if (!this.bkSelectable(dt)) return;
    this.bkDay.set(dt);
    this.bkSlot.set(null);
    this.bkStep.set(2);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  /** Book the call with the fund manager — this SENDS the request. The plot is
   *  not created; it stays pending until the manager approves. */
  bkPickSlot(slot: string): void {
    const type = this.requestType();
    const day = this.bkDay();
    if (!type || !day) return;
    this.bkSlot.set(slot);
    // combine day + slot into a real datetime and book via the shared service
    const [hm, ap] = slot.split(' ');
    let [h, m] = hm.split(':').map(Number);
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const at = new Date(day);
    at.setHours(h, m, 0, 0);
    this.callsSvc.book(at, `Approve & build a ${this.typeWord(type)}`);
    this.bkSent.set(true);
    this.bkStep.set(3);
    if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
  }

  // ------------------------------------------------------------- helpers ---

  private costFor(type: TileType): number {
    if (type === 'villa') return PLOT_TICKET * 3;
    if (type === 'building') return PLOT_TICKET * 2;
    return PLOT_TICKET;
  }

  /** A consistent, numbered name per type: "Villa 1", "Land 1",
   *  "Under Construction 1" — the next number for that type. */
  private nextName(type: TileType): string {
    const n = this.est.countOf(type) + 1;
    const word = type === 'villa' ? 'Villa' : type === 'building' ? 'Under Construction' : 'Land';
    return `${word} ${n}`;
  }

  compact = compact;
  /** Full ₹ with Indian digit grouping (₹1,70,63,583) — the reference headline
   *  shows the full grouped number, not a compacted one. */
  inr = inr;

  get villas(): number { return this.est.countOf('villa'); }
  get buildings(): number { return this.est.countOf('building'); }
  get lands(): number { return this.est.countOf('land'); }
  get open(): number { return this.est.openPlots; }

  // ── INVESTED flow subline: "{villaCount} villa{s} · {buildCount} building" ──
  /** The invested-column context line, derived from the map tiles. Reads
   *  gracefully when a count is 0 (drops that clause), and falls back to a
   *  neutral line when nothing is built yet. */
  get investedSub(): string {
    const v = this.villas;
    const b = this.buildings;
    const parts: string[] = [];
    if (v > 0) parts.push(`${v} villa${v === 1 ? '' : 's'}`);
    if (b > 0) parts.push(`${b} building${b === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'your estate';
  }

  // ── PORTFOLIO VALUE allocation bar (bottom) ──
  /** Segment colours, by allocation order, for the 5-fund allocation bar. */
  private readonly FUND_COLORS = ['#8aa89b', '#f6c445', '#4a9d47', '#5cb85c', '#8fd48a'];
  /** Short fund labels, by allocation order, matching the reference. */
  private readonly FUND_LABELS = ['ARBITRAGE', 'GOLD', 'LARGE CAP', 'MID CAP', 'SMALL CAP'];

  /** The fund allocation rows for the bar (name/category/allocation). Values are
   *  derived from the portfolio value via fundValue() so the bar is instant. */
  get fundRows(): { name: string; scheme_code?: number; category: string; allocation: number }[] {
    return this.alloc();
  }
  /** This fund's ₹ value = its allocation × the live portfolio value. */
  fundValue(f: { allocation: number }): number {
    return Math.round(this.est.estateValue * (f.allocation || 0) / 100);
  }
  /** Colour for the fund at position `i` (wraps if there are more than 5). */
  fundColor(i: number): string {
    return this.FUND_COLORS[i % this.FUND_COLORS.length];
  }
  /** Short display label for the fund at position `i` — the reference short
   *  names by position, falling back to the fund's own category past the 5th. */
  fundLabel(i: number, f: { category: string; name: string }): string {
    return this.FUND_LABELS[i] ?? (f.category || f.name).toUpperCase();
  }
  /** Signed returns % for the meta row (server gain_pct, tile fallback). */
  get gainPct(): number { return this.est.gainPct; }

  /** A warm, time-aware greeting for the top of the home screen. */
  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  /** Total assets owned (villas + builds + lands + the founding villa). */
  get assetCount(): number {
    return this.villas + this.buildings + this.lands + 1; // +1 = founding villa
  }
  get hasAny(): boolean { return this.est.tiles().length > 0; }
}
