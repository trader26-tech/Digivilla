import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { AuthService } from './auth/auth.service';
import { Booking, BookingService } from './booking.service';
import { CallScheduleComponent } from './shared/call-schedule.component';
import { DataFreshnessComponent } from './shared/data-freshness.component';
import { PlotUnlockComponent } from './build/plot-unlock.component';
import { FundMovesSheetComponent } from './home/fund-moves-sheet.component';
import { CallsService } from './shared/calls.service';
import { AllocRow, DayChange, EstateService, FundsBreakdown, Tile, TileType, Variant } from './estate.service';
import { Cell, buildCells } from './estate/board-layout';
import { compact, inr } from './shared/format.util';
import { CalcDataService } from './calc/calc-data.service';
import { rateYears } from './calc/engine';

/** One parcel of the fixed 3x3 reference board — GENERATED from the invested ₹
 *  (villas = floor(invested / ₹5,00,000), plus one building tile from the
 *  remainder), painted with the reference tile symbols. */
interface BoardCell {
  col: number;
  row: number;
  /** True for the one open plot that will be built next (tap → start a SIP). */
  next?: boolean;
  /** Painting depth = col + row (ascending emits back-to-front). */
  d: number;
  /** 0-based house index (position in ORDER) — the ₹5L pillar this parcel is. */
  idx: number;
  /** Offset for the tile <use>, per the reference placement formula. */
  x: number;
  y: number;
  /** villa | build | locked (the reference cell states). */
  st: 'villa' | 'build' | 'locked';
  /** Which reference symbol paints the tile (#tVilla / #tLand / #tGrade / …). */
  href: string;
  /** The tile name ("Villa 03" / "Plot 06" / "Tile 09"). */
  name: string;
  /** The one-line note the detail popup shows. */
  note: string;
  /** ₹25,000 instalments in this house (20 = complete); null for a locked tile. */
  paid: number | null;
  /** A real backing tile for this parcel, if the user owns a matching one —
   *  villas map to real villa tiles in order, the build to the first real
   *  building tile — so a tap can deep-link its live returns page as before. */
  tile: Tile | null;
}

/** One merged segment of the home allocation bar — a sleeve, its total
 *  allocation (all funds of that sleeve summed), its whole-number display share
 *  (largest-remainder, so the shares on screen always add to exactly 100) and
 *  the funds inside it, biggest first. */
interface SleeveRow { sleeve: string; allocation: number; value: number; pct: number; funds: AllocRow[]; }
/** One column of the legend under the bar: a sleeve, or "+N more" folding the
 *  sub-2% sleeves so six tiny labels never crowd a phone-width row. */
interface LegendCol { key: string; label: string; color: string; pct: string; }

// ---- the estate model (ported from design/home-m1/estate-model.js) --
// ₹ per villa, ₹/month per finished villa, the number of plots and the build
// stages are SETTINGS (CalcDataService.config().estate) — see estateOf() below.
// Only the board's geometry (ORDER, the tile art) is fixed here.
/** The board has art for 9 parcels and 5 build stages. */
// This screen is its own (hashed) chunk. Remember where it lives so the next
// signed-in open can modulepreload it straight from index.html, in parallel
// with the app's own scripts — the home stays the first frame.
try { localStorage.setItem('dv_home_chunk', import.meta.url); } catch { /* private mode */ }

export const MAX_PLOTS = 9;
const SWIPE_HINT_KEY = 'dv-swipe-hint-v1';
/** House h of an estate (0-based, within its board of 9) occupies ORDER[h] (col,row) —
 *  the handoff's fill order: the FRONT tile first, working toward the back. A client
 *  with more than 9 houses has more estates, one board each, swiped sideways. */
export const ORDER: [number, number][] = [
  [2, 2], [1, 2], [2, 1], [1, 1], [0, 2], [2, 0], [0, 1], [1, 0], [0, 0],
];
/** Build-stage symbol per stage index (0 ground · 1 The Plot · 2 Levelled ·
 *  3 Foundation · 4 Steel · 5 The Villa). Stage 1 falls back to #tLand. */
const FALLBACK_TILE = ['#tLocked', '#tLand', '#tGrade', '#tFound', '#tSteel', '#tVilla'];
/** Stage names, matching the reference. */
const STAGE_NAME = ['Open tile', 'The Plot', 'Levelled Ground', 'Foundation', 'Steel Frame', 'The Villa'];

/** The estate numbers from the settings, in the shape the board uses. */
export function estateOf(e: { villa_cost: number; villa_income_monthly: number; plots: number; stages: { name: string; at: number }[] }) {
  const stages = e.stages;
  return {
    HOUSE: e.villa_cost,
    HOUSES: Math.max(1, Math.min(MAX_PLOTS, e.plots)),
    INCOME: e.villa_income_monthly,
    STAGES: stages,
    /** build stage reached with ₹rem in the plot: 0 (ground) … 4 (steel) — the art has 5 stages */
    stageOf: (rem: number) => Math.min(4, stages.filter((st) => st.at <= rem).length),
  };
}

/** "Nov ’27": the 5th (SIP day) of the month `m` months from now. */
function monthLabel(m: number): string {
  const d = new Date(); d.setDate(5); d.setMonth(d.getMonth() + m);
  return d.toLocaleString('en-IN', { month: 'short' }) + ' \u2019' + String(d.getFullYear()).slice(-2);
}
/** A client's SIP a month: their SIP orders over the last 6 months, averaged
 *  over the months that had one (two funds the same month count as one month). */
function monthlySip(orders: { date: string; kind: string; amount: number; direction: string }[]): number | null {
  const from = new Date(); from.setMonth(from.getMonth() - 6);
  const cut = from.toISOString().slice(0, 10);
  const sips = orders.filter((o) => o.direction === 'in' && /sip/i.test(o.kind) && o.date >= cut && o.amount > 0);
  const months = new Set(sips.map((o) => o.date.slice(0, 7)));
  return months.size ? sips.reduce((s, o) => s + o.amount, 0) / months.size : null;
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
  imports: [CommonModule, FormsModule, CallScheduleComponent, DataFreshnessComponent, PlotUnlockComponent, FundMovesSheetComponent],
  templateUrl: './estate-home.component.html',
  styleUrl: './estate-home.component.scss',
})
export class EstateHomeComponent implements OnInit {
  /** Hidden file picker behind the corner avatar. */
  @ViewChild('photoInput') photoInput?: ElementRef<HTMLInputElement>;
  /** The live-values sheet, opened by tapping the portfolio figure. */
  @ViewChild(DataFreshnessComponent) fresh!: DataFreshnessComponent;

  /** Play the "verified" tick once, right after OTP (passed by the shell). */
  @Input() justVerified = false;
  /** The tick has played — the shell clears justVerified so a later return to Home doesn't replay it. */
  @Output() verifiedShown = new EventEmitter<void>();

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
  /** the estate numbers (₹ per villa, income, plots, stages) — from the settings */
  private get E() { return estateOf(this.calc.config().estate); }
  private readonly callsSvc = inject(CallsService);
  private readonly bookingSvc = inject(BookingService);
  private readonly auth = inject(AuthService);
  /** The shared demo account: the title says it's sample data. */
  readonly isDemo = this.auth.isDemo;
  readonly readOnly = this.auth.readOnly;

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
  /** "Your mix" — the fund-by-fund sheet behind the allocation bar. */
  mixOpen = signal(false);
  openMix(): void { this.mixOpen.set(true); if (navigator.vibrate) navigator.vibrate(4); }
  /** "Day's change" — the fund-by-fund sheet behind the day chip. */
  /** "How your funds moved" (today fund by fund · each fund vs its index). */
  movesOpen = signal(false);
  openMoves(): void { this.est.loadMoves(); this.movesOpen.set(true); if (navigator.vibrate) navigator.vibrate(4); }

  /** The user's fund-by-fund breakdown (from GET /me/funds) — drives the
   *  PORTFOLIO VALUE allocation bar at the bottom of the home screen. Null until
   *  it loads (or when signed out / offline), so the bar is gated on it. */
  funds = signal<FundsBreakdown | null>(null);
  /** Instant fund allocation for the PORTFOLIO bar — read straight from the
   *  service cache warmed during the splash, so it's present on first paint. */
  alloc = computed<AllocRow[]>(() => this.est.allocRows() ?? []);

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
  // The board is GENERATED from the user's invested ₹, per the reference model
  // (applyEstate, ported verbatim): villas = floor(invested / ₹5,00,000) capped
  // at 9, plus one building tile whose stage comes from the remainder. Each of
  // the nine cells is placed with the reference's exact formula:
  //   x = (col - row) * 93.6 ;  y = (col + row) * 54
  // and cells are painted in ascending (col + row) so back tiles paint over
  // front tiles (SVG has no z-buffer — document order IS depth).

  /** Still used by the empty-state centre + the metaphor-key previews. */
  cells = computed<Cell[]>(() => buildCells(this.est.tiles()));

  /** The board from the admin's transaction → villa pins (each house = ITS
   *  transactions), or null when nothing is pinned yet — then the board falls
   *  back to the invested-₹ model below. Comes with the portfolio, so the board
   *  paints right the first time. */
  private get layout() { const l = this.est.portfolio()?.houses_layout; return l && l.length ? l : null; }

  /** The ₹ that drives the board — the user's live INVESTED amount, clamped to
   *  0..₹45,00,000 (nine finished villas). NOT the portfolio value. */
  get boardWorth(): number { return Math.max(0, this.est.invested); }
  /** Every house the client owns, in board order: the server's layout (each house = its
   *  own transactions), else one ₹5 L villa per full ₹5 L invested plus the remainder. */
  readonly houses = computed<{ building: boolean; invested: number }[]>(() => {
    const l = this.layout;
    if (l) return l;
    const worth = this.boardWorth, H = this.E.HOUSE;
    const n = Math.floor(worth / H), rem = worth - n * H;
    const out = Array.from({ length: n }, () => ({ building: false, invested: H }));
    if (rem > 0) out.push({ building: true, invested: rem });
    return out;
  });
  /** Finished villas — all of them (there is no 9-villa ceiling: more villas = more estates). */
  get villaCount(): number { return this.houses().filter((h) => !h.building).length; }
  /** ₹ in the house currently being built (the oldest one still building). */
  get buildRem(): number { return this.houses().find((h) => h.building)?.invested ?? 0; }
  /** Build stage of the plot in progress (0 ground · 1 Plot · … · 4 Steel). */
  get buildStage(): number { return this.E.stageOf(this.buildRem); }
  /** Houses still under construction (one per villa bucket can be open at once). */
  get buildingCount(): number { return this.houses().filter((h) => h.building).length; }
  get building(): boolean { return this.buildingCount > 0; }

  // ── ESTATES: 9 parcels a board; swipe sideways between them ──
  /** How many boards the houses fill — always at least one. */
  readonly boards = computed(() => Math.max(1, Math.ceil(this.houses().length / this.E.HOUSES)));
  /** The board on screen; null = follow the newest one (where the latest money went). */
  private readonly pageSel = signal<number | null>(null);
  readonly page = computed(() => Math.min(this.boards() - 1, Math.max(0, this.pageSel() ?? this.boards() - 1)));
  readonly boardList = computed(() => Array.from({ length: this.boards() }, (_, i) => i));
  /** 'l' / 'r' while a board slides out, then in — drives the CSS swap animation */
  readonly flip = signal<'' | 'out-l' | 'out-r' | 'in-l' | 'in-r'>('');
  /** the finger's live drag on the board (px), for the follow-the-finger feel */
  readonly dragX = signal(0);
  goBoard(p: number): void {
    const to = Math.max(0, Math.min(this.boards() - 1, p)), from = this.page();
    if (to === from) return;
    const dir = to > from ? 1 : -1;
    if (navigator.vibrate) navigator.vibrate(4);
    this.flip.set(dir > 0 ? 'out-l' : 'out-r');
    setTimeout(() => {
      this.pageSel.set(to);
      this.flip.set(dir > 0 ? 'in-r' : 'in-l');
      setTimeout(() => this.flip.set(''), 340);
    }, 170);
  }
  private bx: number | null = null; private by = 0; private bMoved = false;
  onBoardDown(e: PointerEvent): void { if (this.boards() < 2) return; this.bx = e.clientX; this.by = e.clientY; this.bMoved = false; }
  onBoardMove(e: PointerEvent): void {
    if (this.bx === null) return;
    const dx = e.clientX - this.bx;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - this.by)) { this.bMoved = true; this.dragX.set(dx * 0.5); }
  }
  onBoardUp(e: PointerEvent): void {
    if (this.bx === null) return;
    const dx = e.clientX - this.bx;
    this.bx = null; this.dragX.set(0);
    if (this.bMoved && Math.abs(dx) > 45) this.goBoard(this.page() + (dx < 0 ? 1 : -1));
  }
  /** a sideways drag must not also count as a tap on the parcel under the finger */
  onBoardClickCapture(e: Event): void { if (this.bMoved) { e.stopPropagation(); e.preventDefault(); this.bMoved = false; } }
  /** "YOUR ESTATE · 2 OF 3" */
  get kicker(): string {
    const base = this.isDemo() ? 'DEMO ESTATE' : 'YOUR ESTATE';
    if (this.boards() > 1) return `${base} · ${this.page() + 1} OF ${this.boards()}`;
    return this.isDemo() ? 'DEMO ESTATE · SAMPLE DATA' : base;
  }
  /** the avatar: the photo set on the Settings page (or here), else the name's first letter */
  get avatarPhoto(): string {
    try { return localStorage.getItem('sc.avatar') || this.est.profile()?.photo || ''; } catch { return this.est.profile()?.photo || ''; }
  }
  get avatarInitial(): string {
    const n = (this.est.estateName || '').trim();
    return n ? n.charAt(0).toUpperCase() : '•';
  }

  /** The nine parcels, generated + sorted back-to-front for painting. Ported
   *  verbatim from applyEstate(): villas fill ORDER[0..villas-1], the build (if
   *  any) sits at ORDER[villas], the rest are locked. */
  boardCells = computed<BoardCell[]>(() => {
    const layout = this.layout;
    if (layout || this.boards() > 1) return this.pinnedCells(this.houses(), this.page());
    const worth = this.boardWorth;
    const villas = Math.min(this.E.HOUSES, Math.floor(worth / this.E.HOUSE));
    const rem = worth - villas * this.E.HOUSE;
    const stage = villas >= this.E.HOUSES ? 0 : this.E.stageOf(rem);
    const building = villas < this.E.HOUSES && rem > 0;

    // Real holdings, most-established first, so a generated villa/build can be
    // backed by (and deep-link to) a real tile when the user owns one.
    const typeOrder: TileType[] = ['villa', 'building', 'land'];
    const owned = [...this.est.tiles()].sort(
      (a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.boughtAt - b.boughtAt,
    );
    const realVillas = owned.filter((t) => t.type === 'villa');
    const realBuild = owned.find((t) => t.type === 'building' || t.type === 'land') ?? null;

    const cells: BoardCell[] = ORDER.map(([col, row], i) => {
      const n = ('0' + (i + 1)).slice(-2);
      const base = { col, row, d: col + row, idx: i, x: (col - row) * 93.6, y: (col + row) * 54 };
      if (i < villas) {
        return {
          ...base, st: 'villa', href: '#tVilla', name: `Villa ${n}`,
          note: 'Complete · ₹5,00,000 · pays ₹1,500 a month', paid: 20,
          tile: realVillas[i] ?? null,
        };
      }
      if (i === villas && building) {
        return {
          ...base, st: 'build',
          href: stage === 0 ? '#tGround' : FALLBACK_TILE[stage],
          name: `Plot ${n}`,
          note: `${stage === 0 ? 'Breaking ground' : STAGE_NAME[stage]} · ${inr(rem)} of ${inr(this.E.HOUSE)}`,
          paid: Math.round(rem / 25000),
          tile: realBuild,
        };
      }
      const nextIdx = villas + (building ? 1 : 0);
      return {
        ...base, st: 'locked', href: '#tLocked', name: `Plot ${n}`, note: 'open', paid: null, tile: null,
        next: i === nextIdx && nextIdx < this.E.HOUSES,
      };
    });
    // Paint back-to-front: (col+row) ascending, ties by col ascending.
    return cells.sort((a, b) => a.d - b.d || a.col - b.col);
  });

  /** The board when the admin has pinned transactions to villas: house i sits on
   *  ORDER[i] — a finished villa, or a build at ITS own stage — so every parcel
   *  is a real villa with its own money, and tapping it opens villa_<i>. */
  private pinnedCells(all: { building: boolean; invested: number }[], page = 0): BoardCell[] {
    const P = this.E.HOUSES, start = page * P;
    const houses = all.slice(start, start + P);
    const nextIdx = houses.length < P ? houses.length : -1;
    const cells: BoardCell[] = ORDER.map(([col, row], k) => {
      const i = start + k;                     // the house's place in the whole estate (villa_<i>)
      const n = ('0' + (i + 1)).slice(-2);
      const base = { col, row, d: col + row, idx: i, x: (col - row) * 93.6, y: (col + row) * 54 };
      const h = houses[k];
      if (h && !h.building) {
        return { ...base, st: 'villa', href: '#tVilla', name: `Villa ${n}`,
                 note: `Complete · ${inr(h.invested)} · pays ${inr(this.E.INCOME)} a month`, paid: 20, tile: null } as BoardCell;
      }
      if (h) {
        const stage = this.E.stageOf(h.invested);
        return { ...base, st: 'build', href: stage === 0 ? '#tGround' : FALLBACK_TILE[stage], name: `Plot ${n}`,
                 note: `${stage === 0 ? 'Breaking ground' : STAGE_NAME[stage]} · ${inr(h.invested)} of ${inr(this.E.HOUSE)}`,
                 paid: Math.round(h.invested / 25000), tile: null } as BoardCell;
      }
      return { ...base, st: 'locked', href: '#tLocked', name: `Plot ${n}`, note: 'open', paid: null, tile: null,
               next: k === nextIdx } as BoardCell;
    });
    return cells.sort((a, b) => a.d - b.d || a.col - b.col);
  }

  /** The rent coin bobs over the centre parcel (ORDER[0] = (1,1)), shown only
   *  once at least one villa exists — exactly as the reference markup fixes it
   *  at (120,124) over the first villa. */
  boardCoin = computed<boolean>(() => this.boardCells().some((c) => c.st === 'villa'));
  /** The coin (authored at 120,124 over the centre parcel) moves to this board's first villa. */
  readonly coinAt = computed(() => {
    const c = this.boardCells().filter((x) => x.st === 'villa').sort((a, b) => a.idx - b.idx)[0];
    return c ? `translate(${(120 + c.x).toFixed(1)},${(124 + c.y - 108).toFixed(1)})` : 'translate(120,124)';
  });

  /** Tapping a villa/build parcel opens its detail — deep-linking a real
   *  backing tile's live returns page when the user owns one, otherwise the
   *  self-contained detail popup (which needs no server tile). Locked parcels
   *  are inert, as before. */
  tapBoardCell(c: BoardCell): void {
    if (navigator.vibrate) navigator.vibrate(4);
    // an EMPTY parcel → the sheet that says at which level it unlocks
    if (c.st === 'locked') { this.unlockCell.set(c); return; }
    // EVERY parcel — finished villa or any build stage — opens the real report for
    // ITS ₹5L pillar (villa_<idx>): the same invested-driven slice the board was
    // generated from, so the page's numbers match what the board shows.
    this.openTile.emit({
      id: `villa_${c.idx}`,
      type: c.st === 'villa' ? 'villa' : 'building',
      variant: 'balanced',
      cost: this.E.HOUSE,
      sipMonthly: 0,
      sipAccrued: c.paid ? c.paid * 25_000 : 0,
      rentMonthly: c.st === 'villa' ? this.E.INCOME : 0,
      boughtAt: Date.now(),
      label: c.name,
    });
  }

  /** The empty parcel whose "unlocks at level N" sheet is open. */
  unlockCell = signal<BoardCell | null>(null);

  /** The generated parcel whose local detail popup is open (no real tile). */
  selectedBoard = signal<BoardCell | null>(null);
  closeBoardDetail(): void { this.selectedBoard.set(null); }

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

  /** True once we have REAL data to paint the home figures from — the first
   *  /me/portfolio response has landed (ok or error; on error we fall back to
   *  the cached tiles). Until then the home shows a quiet skeleton instead of
   *  flashing ₹0 / a wrong state and then jumping to the real numbers. */
  get dataReady(): boolean {
    return this.est.portfolioLoaded() && this.est.allocLoaded();
  }

  // ------------------------------------------------------------ lifecycle --

  /** Entrance animations play only the FIRST time Home mounts per app open. */
  readonly entered = this.est.homeEntered();

  ngOnInit(): void {
    // the day-change sheet's data, warmed after the home has settled (one cached call)
    setTimeout(() => this.est.loadMoves(), 4500);
    // Mark the entrance as played (for the next mount, not this one).
    this.est.homeEntered.set(true);
    // Play the verified tick once, right after OTP.
    if (this.justVerified) {
      this.verifiedShown.emit();
      this.showTick.set(true);
      setTimeout(() => this.showTick.set(false), 1900);
    }
    // Load any upcoming setup call so an empty estate can show it.
    this.loadUpcomingCall();
    // The allocation is prefetched during the splash into est.allocRows(); the
    // `alloc` computed below reads that cache, so the bar is ready the instant the
    // home paints. We still kick a fresh load in case the splash was skipped
    // (deep-link) or the token arrived late.
    if (!this.est.allocRows()) this.est.loadAllocation();
    // The client's real monthly SIP (for "Next villa" — when it completes).
    this.calc.loadConfig();
    this.est.orders().subscribe({ next: (r) => this.sipMonthly.set(monthlySip(r.orders ?? [])), error: () => {} });
    // first visit only: say what the two swipes do (there are no buttons for them)
    try {
      if (!localStorage.getItem(SWIPE_HINT_KEY)) {
        this.swipeHint.set(true);
        setTimeout(() => this.dismissHint(), 7000);
      }
    } catch { /* private mode — skip the hint */ }
  }

  // ════════════ PULL SHEETS — swipe down: Next villa · swipe up: What does a villa represent? ════════════
  readonly calc = inject(CalcDataService);
  readonly nextOpen = signal(false);
  readonly typesOpen = signal(false);
  /** the villa sheet rises from the bottom edge — hide the app's tab bar while it's up */
  private readonly hideTabbar = (() => {
    effect(() => document.body.classList.toggle('tv-sheet-open', this.typesOpen()));
    inject(DestroyRef).onDestroy(() => document.body.classList.remove('tv-sheet-open'));
    return true;
  })();
  /** The client's SIP a month, from their SIP orders over the last 6 months (null = none). */
  readonly sipMonthly = signal<number | null>(null);
  /** the one-time "swipe down · swipe up" hint */
  readonly swipeHint = signal(false);
  dismissHint(): void {
    if (!this.swipeHint()) return;
    this.swipeHint.set(false);
    try { localStorage.setItem(SWIPE_HINT_KEY, '1'); } catch { /* private mode */ }
  }

  /** Another sheet / popup owns the screen — swipes leave it alone. */
  private get overlayOpen(): boolean {
    return this.keyOpen() || this.mixOpen() || this.movesOpen() || this.callSheetOpen() || this.settingsOpen() || !!this.buying() || !!this.selected()
      || !!this.selectedBoard() || !!this.unlockCell() || this.showTick();
  }
  setNext(open: boolean): void {
    this.nextOpen.set(open);
    if (open) this.typesOpen.set(false);
  }
  setTypes(open: boolean): void {
    this.typesOpen.set(open);
    if (open) { this.nextOpen.set(false); this.calc.load(); }
  }
  closeSheets(): void { this.nextOpen.set(false); this.typesOpen.set(false); }
  /** down = pull the Next villa sheet in (or put Types away); up = the reverse */
  private swipe(dir: 'down' | 'up'): void {
    this.dismissHint();
    if (dir === 'down') { if (this.typesOpen()) this.setTypes(false); else this.setNext(true); }
    else if (this.nextOpen()) this.setNext(false); else this.setTypes(true);
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
  }
  private ty: number | null = null;
  private tx = 0;
  onTouchStart(e: TouchEvent): void {
    if (this.overlayOpen || !this.dataReady || e.touches.length > 1) { this.ty = null; return; }
    this.ty = e.touches[0].clientY; this.tx = e.touches[0].clientX;
  }
  onTouchMove(e: TouchEvent): void {
    if (this.ty === null) return;
    const dy = e.touches[0].clientY - this.ty, dx = e.touches[0].clientX - this.tx;
    if (Math.abs(dy) > 64 && Math.abs(dy) > Math.abs(dx) * 1.4) { this.swipe(dy > 0 ? 'down' : 'up'); this.ty = null; }
  }
  onTouchEnd(): void { this.ty = null; }
  private wheelAcc = 0;
  private wheelT: ReturnType<typeof setTimeout> | undefined;
  onWheel(e: WheelEvent): void {
    if (this.overlayOpen || !this.dataReady) return;
    this.wheelAcc += e.deltaY;
    clearTimeout(this.wheelT);
    this.wheelT = setTimeout(() => (this.wheelAcc = 0), 180);
    if (this.wheelAcc < -60) { this.swipe('down'); this.wheelAcc = 0; }
    else if (this.wheelAcc > 60) { this.swipe('up'); this.wheelAcc = 0; }
  }

  /** The Next villa sheet: the stages left on the plot in progress, when it completes, and the income step. */
  get nextInfo() {
    const E = this.E;
    const villas = this.villaCount;
    const estatePlots = this.boards() * E.HOUSES;      // the parcels on every board the client has
    const rem = Math.max(0, Math.min(E.HOUSE, this.buildRem));
    const sip = this.sipMonthly();
    const toGo = E.HOUSE - rem;
    const months = sip && sip > 0 ? Math.max(1, Math.ceil(toGo / sip)) : null;
    const ART = ['#tLand', '#tGrade', '#tFound', '#tSteel', '#tVilla'];
    const nowIdx = E.STAGES.findIndex((st) => st.at > rem);
    const steps = E.STAGES.map((st, i) => {
      const from = i ? E.STAGES[i - 1].at : 0;
      const frac = Math.max(0, Math.min(1, (rem - from) / (st.at - from)));
      const state = frac >= 1 ? 'done' : i === nowIdx ? 'now' : 'todo';
      const m = state === 'done' ? 'built' : state === 'now' ? Math.round(frac * 100) + '%'
        : sip && sip > 0 ? monthLabel(Math.max(1, Math.ceil((st.at - rem) / sip))) : inr(st.at - rem);
      return { href: ART[Math.min(i, ART.length - 1)], name: st.name, state, pct: Math.round(frac * 100), m };
    });
    return {
      done: false as const, plot: String(villas + 1).padStart(2, '0'), toGo, months,
      when: months ? monthLabel(months) : null, sip, steps,
      each: E.INCOME, plots: estatePlots,
      now: E.INCOME * villas, after: E.INCOME * (villas + 1), all: E.INCOME * estatePlots,
    };
  }
  /** The three villas, for the Types sheet (rate = growth a year since Apr 2010, nothing withdrawn). */
  readonly villaTypes = computed(() => {
    const rates = this.calc.rates();
    const first = this.calc.config().income.pay_first;
    return this.calc.config().villas.map((v, i) => {
      const w = v.weights as Record<string, number>;
      const pf = first.reduce((s, k) => s + (w[k] ?? 0), 0);
      return { ...v, growth: 1 - pf, payFirst: pf, rate: rates ? rates[v.key] ?? null : null, d: i * 70 };
    });
  });
  /** first month of the window behind each villa's "% a yr" (the last display.rate_years — a setting) */
  readonly historyFrom = computed(() => {
    const ms = this.calc.data()?.months;
    const m = ms?.[Math.max(0, ms.length - 1 - 12 * rateYears(this.calc.config()))];
    if (!m) return '';
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${M[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  });

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

  // ── HEADER FLOWS — ported verbatim from applyEstate() ────────────────────
  /** WITHDRAWALS (gold): ₹1,500 per finished villa, per month. */
  get withdrawAmt(): number { return this.E.INCOME * this.villaCount; }
  /** WITHDRAWALS sub-line: "N villa(s) · SWP on the 1st", else the primer. */
  get withdrawSub(): string {
    const v = this.villaCount;
    return v ? `${v} villa${v === 1 ? '' : 's'} · SWP on the 1st` : 'Starts with your first villa';
  }
  /** INVESTED (violet) figure: the board worth (clamped invested ₹). */
  get investedAmt(): number { return this.boardWorth; }
  /** INVESTED sub-line: reflects the plot in progress / estate completion. */
  get investedSub(): string {
    const b = this.buildingCount;
    return b ? `${b} building${b === 1 ? '' : 's'} · SIP on the 5th` : 'Next plot · SIP on the 5th';
  }

  // ── PORTFOLIO VALUE allocation bar (bottom) ──
  // The bar is the client's REAL mix: every fund they hold at units × live NAV
  // (GET /me/allocation), grouped by sleeve — never the model villa weights.
  // Label + colour come from the fund's sleeve (admin-set, else inferred on the
  // server); only truly-unknown funds fall to the neutral "OTHER" style.
  // Left → right: steady/income first, then growth by rising risk.
  private readonly SLEEVE_ORDER = ['arbitrage', 'debt', 'hybrid', 'gold', 'large', 'multi', 'mid', 'small', 'other'];
  private readonly SLEEVE_STYLE: Record<string, { label: string; name: string; color: string; plain: string }> = {
    arbitrage: { label: 'ARBITRAGE', name: 'Arbitrage', color: '#8aa89b', plain: 'The steady part — your monthly income is paid from here.' },
    debt:      { label: 'DEBT',      name: 'Debt',      color: '#7fa9c9', plain: 'Bonds and money-market — steady, low swings.' },
    hybrid:    { label: 'HYBRID',    name: 'Hybrid',    color: '#a99be6', plain: 'Equity and debt inside one fund.' },
    gold:      { label: 'GOLD',      name: 'Gold',      color: '#f6c445', plain: 'Moves with gold — a cushion when shares fall.' },
    large:     { label: 'LARGE CAP', name: 'Large cap', color: '#4a9d47', plain: 'India’s 100 biggest companies.' },
    multi:     { label: 'MULTI CAP', name: 'Multi cap', color: '#3f9a86', plain: 'Big, mid and small companies in one fund.' },
    mid:       { label: 'MID CAP',   name: 'Mid cap',   color: '#5cb85c', plain: 'Mid-size companies — more growth, more swing.' },
    small:     { label: 'SMALL CAP', name: 'Small cap', color: '#8fd48a', plain: 'Small companies — the fastest growth, the biggest swings.' },
    other:     { label: 'OTHER',     name: 'Other',     color: '#9fb3ab', plain: 'Funds outside the usual mix.' },
  };

  /** Resolve a row's sleeve — the server's value, else inferred from the
   *  category/name (an older backend), never blank. */
  private sleeveOf(f: AllocRow): string {
    const s = (f.sleeve || '').toLowerCase();
    if (this.SLEEVE_STYLE[s]) return s;
    const hay = `${(f.category || '').toLowerCase()} ${(f.name || '').toLowerCase()}`;
    if (hay.includes('arbitrage')) return 'arbitrage';
    if (hay.includes('gold')) return 'gold';
    if (hay.includes('hybrid') || hay.includes('equity savings') || hay.includes('balanced')) return 'hybrid';
    if (hay.includes('small')) return 'small';
    if (hay.includes('mid')) return 'mid';
    if (hay.includes('flexi') || hay.includes('multi') || hay.includes('momentum')) return 'multi';
    if (hay.includes('large') || hay.includes('index')) return 'large';
    return 'other';
  }

  /** The allocation bar rows — one per SLEEVE, not per fund. Funds that share a
   *  sleeve (e.g. two small-cap funds) are merged into a single segment/label.
   *  A computed (not a getter) so the SAME array/objects are returned until the
   *  allocation actually changes — with a getter, every change-detection pass
   *  built fresh objects and *ngFor re-created the segments, replaying the wipe. */
  readonly fundRowsMemo = computed<SleeveRow[]>(() => this.buildFundRows());
  get fundRows(): SleeveRow[] { return this.fundRowsMemo(); }
  trackSleeve = (_: number, r: { sleeve?: string; key?: string }) => r.sleeve ?? r.key;
  trackFund = (_: number, f: AllocRow) => f.scheme_code ?? f.name;

  private buildFundRows(): SleeveRow[] {
    const by = new Map<string, SleeveRow>();
    for (const f of this.alloc()) {
      if (!(f.allocation > 0)) continue;
      const sleeve = this.sleeveOf(f);
      const row = by.get(sleeve) ?? { sleeve, allocation: 0, value: 0, pct: 0, funds: [] };
      row.allocation += f.allocation;
      row.value += f.value ?? 0;
      row.funds.push(f);
      by.set(sleeve, row);
    }
    const rows = this.SLEEVE_ORDER.filter((k) => by.has(k)).map((k) => by.get(k)!);
    for (const r of rows) r.funds.sort((a, b) => b.allocation - a.allocation);
    // Largest remainder: floor every share, then hand the leftover points to the
    // biggest fractions — the whole numbers on screen always sum to exactly 100.
    const total = rows.reduce((t, r) => t + r.allocation, 0) || 1;
    const exact = rows.map((r) => (r.allocation / total) * 100);
    rows.forEach((r, i) => (r.pct = Math.floor(exact[i])));
    let left = 100 - rows.reduce((t, r) => t + r.pct, 0);
    const byFrac = rows.map((_, i) => i).sort((a, b) => (exact[b] % 1) - (exact[a] % 1));
    for (const i of byFrac) { if (left <= 0) break; rows[i].pct++; left--; }
    return rows;
  }

  /** The legend under the bar: every sleeve of ≥ 2%, the rest folded into one
   *  "+N MORE" column (they're all in the bar, and all in the Your-mix sheet). */
  readonly legendMemo = computed<LegendCol[]>(() => {
    const rows = this.fundRowsMemo();
    const big = rows.filter((r) => r.allocation >= 2);
    const small = rows.filter((r) => r.allocation < 2);
    const cols: LegendCol[] = big.map((r) => ({
      key: r.sleeve, label: this.fundLabel(0, r), color: this.fundColor(0, r), pct: this.fundPct(r),
    }));
    if (small.length === 1 && cols.length < 5) {
      const r = small[0];
      cols.push({ key: r.sleeve, label: this.fundLabel(0, r), color: this.fundColor(0, r), pct: this.fundPct(r) });
    } else if (small.length) {
      const sum = small.reduce((t, r) => t + r.allocation, 0);
      cols.push({ key: 'more', label: `+${small.length} MORE`, color: 'var(--color-neutral-400)',
                  pct: sum < 1 ? '<1%' : Math.round(sum) + '%' });
    }
    return cols;
  });
  get legend(): LegendCol[] { return this.legendMemo(); }

  /** How many distinct funds the client holds (for the sheet's sub-line). */
  get fundCount(): number { return this.fundRows.reduce((n, r) => n + r.funds.length, 0); }

  /** Whole-rupee value of every sleeve row and fund, scaled from the server's
   *  real values onto the headline portfolio value (a NAV refresh can land
   *  between the two calls) and rounded by largest remainder — sleeves add up
   *  to the headline to the rupee, and each sleeve's funds add up to it. */
  private readonly valueMemo = computed(() => {
    const m = new Map<object, number>();
    const rows = this.fundRowsMemo();
    const head = this.est.estateValue;
    const worth = rows.reduce((t, r) => t + r.value, 0);
    const exact = (v: number, a: number) => (worth > 0 ? v * head / worth : head * a / 100);
    const split = (items: { key: object; x: number }[], total: number) => {
      const fl = items.map((it) => Math.floor(it.x));
      let left = total - fl.reduce((t, v) => t + v, 0);
      items.map((_, i) => i).sort((a, b) => (items[b].x % 1) - (items[a].x % 1))
        .forEach((i) => { if (left > 0) { fl[i]++; left--; } });
      items.forEach((it, i) => m.set(it.key, fl[i]));
    };
    split(rows.map((r) => ({ key: r, x: exact(r.value, r.allocation) })), Math.round(head));
    for (const r of rows) {
      split(r.funds.map((f) => ({ key: f, x: exact(f.value ?? 0, f.allocation) })), m.get(r)!);
    }
    return m;
  });
  fundValue(f: { allocation: number }): number {
    return this.valueMemo().get(f) ?? Math.round(this.est.estateValue * (f.allocation || 0) / 100);
  }
  /** A sleeve's share as a whole-number percent ("36%"); a real but tiny
   *  holding reads "<1%", never a misleading "0%". */
  fundPct(f: { allocation: number; pct?: number }): string {
    const p = f.pct ?? Math.round(f.allocation || 0);
    return p < 1 && (f.allocation || 0) > 0 ? '<1%' : p + '%';
  }
  /** One fund's share, one decimal ("23.6%") — finer than the sleeve row. */
  fundPctFine(f: AllocRow): string {
    const a = f.allocation || 0;
    return a > 0 && a < 0.1 ? '<0.1%' : a.toFixed(1) + '%';
  }
  /** Colour for a sleeve — matches its label. */
  fundColor(_i: number, f?: { sleeve: string }): string {
    return this.SLEEVE_STYLE[f?.sleeve ?? 'other']?.color ?? this.SLEEVE_STYLE['other'].color;
  }
  /** Short display label for a sleeve (ARBITRAGE / GOLD / LARGE CAP / …). */
  fundLabel(_i: number, f: { sleeve: string }): string {
    return this.SLEEVE_STYLE[f.sleeve]?.label ?? this.SLEEVE_STYLE['other'].label;
  }
  /** Sentence-case name + one plain line for the sheet ("Mid cap" · "Mid-size …"). */
  sleeveName(f: { sleeve: string }): string { return (this.SLEEVE_STYLE[f.sleeve] ?? this.SLEEVE_STYLE['other']).name; }
  sleevePlain(f: { sleeve: string }): string { return (this.SLEEVE_STYLE[f.sleeve] ?? this.SLEEVE_STYLE['other']).plain; }
  /** A fund's display name — the server's tidy short name, else the raw one. */
  fundName(f: AllocRow): string { return f.short || f.name; }
  /** Bar/legend accessible summary: "Arbitrage 37%, Gold 16%, …". */
  get mixSummary(): string {
    return this.fundRows.map((r) => `${this.sleeveName(r)} ${this.fundPct(r)}`).join(', ');
  }
  // ════════════ DAY'S CHANGE — the move between the last two published NAVs ════════════
  /** The portfolio's day move (null until the server knows the previous NAVs —
   *  then there's simply no chip, never a placeholder that changes). */
  get day(): DayChange | null { return this.est.portfolio()?.day ?? null; }
  /** "+₹1,234" / "−₹943" — a true minus sign, rupees grouped the Indian way. */
  signedInr(v: number): string { return (v < 0 ? '−' : '+') + inr(Math.abs(v)); }
  /** "+0.42%" / "−0.05%" — two decimals under 1%, one above. */
  signedPct(v: number): string {
    const a = Math.abs(v);
    return (v < 0 ? '−' : '+') + a.toFixed(a < 1 ? 2 : 1) + '%';
  }
  /** When the move happened, in words: today · yesterday · Fri 10 Oct. NAV dates
   *  are Indian dates, so "today" is today in IST whatever the phone's zone. */
  dayWhen(iso: string): string {
    const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
    if (iso === ist(Date.now())) return 'today';
    if (iso === ist(Date.now() - 86_400_000)) return 'yesterday';
    return this.dayShort(iso);
  }
  /** "Mon 12 Oct". */
  dayShort(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
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
