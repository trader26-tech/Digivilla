"""Daily NAV cache — the app's source of current mutual-fund NAVs.

Source order: AMFI's own NAVAll.txt (authoritative, and typically hours ahead of
the mirrors), then api.mfapi.in as a per-scheme fallback.

Indian MF NAVs are published ONCE PER DAY by the AMCs (finalized ~11pm–1am IST)
and do not change intraday, so there is nothing to "stream": a persistent socket
per user would sit idle 24/7 for a single daily update. Instead we keep the
latest published NAV per scheme in the shared Supabase table ``scheme_nav_cache``
and read from it — instant, shared across workers, and it survives restarts.

Freshness is kept OFF the request path:
  1. A per-worker refresher thread (``start_refresher``, every 10 min and
     whenever a request sees a stale row) pulls AMFI's file, upserts every held
     scheme that moved, and warms the previous NAV behind the day's change.
  2. A request never waits on AMFI unless a scheme has no cached row at all —
     a stale row is served as is and the refresher is nudged.

A per-worker memo (15 min, re-stamped by the refresher) means the home screen's
NAV reads are in-memory; a cold memo costs one batched DB read.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import re

import httpx


_MEMO_TTL = 900  # seconds — a per-worker read memo, NOT the source of truth
# A row pulled from AMFI within this window is current, whatever its nav_date:
# NAVs publish once a day, so between publishes "yesterday's NAV" IS the latest.
# (The old rule — fresh only if nav_date == today — was never true during the
# day or at weekends, so every memo miss re-downloaded AMFI on the request path:
# a 10 s first load on the home screen.)
_FRESH_FOR = 30 * 60
# { scheme_code: (memo_time, {"nav", "nav_date", "fetched_at"}) }
_memo: dict[int, tuple[float, dict]] = {}

IST = timezone(timedelta(hours=5, minutes=30))
# The daily cron (scripts/refresh_navs.py) runs at 01:00 IST, after the AMCs'
# ~11 PM–1 AM publish. Surfaced to the app as "next NAV update".
REFRESH_HOUR_IST = 1

_MFAPI = "https://api.mfapi.in/mf/{code}/latest"

# AMFI's own published NAV file — the PRIMARY source. It is the industry's
# source of truth (the same file every platform reads), and it carries the day's
# NAVs HOURS before the mfapi mirror does: on 16 Sep 2026 AMFI already served
# 16-Sep for every held scheme while mfapi was still serving 15-Sep. Reading it
# directly is what keeps our values in step with platforms like AssetPlus.
# One 1.5 MB fetch covers ~14,000 schemes and parses in ~10 ms, so a single
# snapshot serves every holding at once. mfapi stays as the per-scheme fallback.
_AMFI = "https://www.amfiindia.com/spages/NAVAll.txt"
_AMFI_TTL = 900  # seconds — a per-worker snapshot of the whole file
_amfi_snap: tuple[float, dict[int, tuple[float, str]]] = (0.0, {})


def _amfi_snapshot(force: bool = False) -> dict[int, tuple[float, str]]:
    """{scheme_code: (nav, nav_date_iso)} for every scheme AMFI publishes.

    Cached per worker for _AMFI_TTL. On any failure returns the last good
    snapshot (or {}), so a network blip just falls through to mfapi.
    """
    global _amfi_snap
    now = time.time()
    if not force and _amfi_snap[1] and now - _amfi_snap[0] < _AMFI_TTL:
        return _amfi_snap[1]
    try:
        r = httpx.get(_AMFI, timeout=30, follow_redirects=True,
                      headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        out: dict[int, tuple[float, str]] = {}
        for line in r.text.splitlines():
            # Scheme Code;ISIN;ISIN;Scheme Name;…;Net Asset Value;Date
            parts = line.split(";")
            if len(parts) < 8:
                continue
            code = parts[0].strip()
            if not code.isdigit():
                continue
            nav_s, date_s = parts[-2].strip(), parts[-1].strip()
            try:
                nav = float(nav_s)
                nav_date = datetime.strptime(date_s, "%d-%b-%Y").date().isoformat()
            except ValueError:
                continue
            out[int(code)] = (nav, nav_date)
        if out:
            _amfi_snap = (now, out)
    except Exception:
        pass
    return _amfi_snap[1]


def _fetch_latest(scheme_code: int) -> Optional[tuple[float, str, str]]:
    """(nav, nav_date_iso, scheme_name) from AMFI first, then mfapi.

    AMFI is authoritative and fresher; mfapi covers the rare scheme AMFI's file
    omits and acts as the safety net when amfiindia.com is unreachable.
    """
    hit = _amfi_snapshot().get(int(scheme_code))
    if hit:
        return hit[0], hit[1], ""
    return _fetch_latest_from_mfapi(scheme_code)


def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def _today_iso() -> str:
    """Today in INDIA — NAV dates are IST dates (the server clock is UTC)."""
    return datetime.now(IST).date().isoformat()


def _parse_utc(v) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


_ISO_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _is_fresh(row: Optional[dict]) -> bool:
    """Is this cached row the latest published NAV? Yes if it is stamped today
    (IST), or was pulled from AMFI in the last _FRESH_FOR. A row whose nav_date is
    not an ISO date (another writer's '23-10-2026') is never fresh — the refresher
    replaces it on its next pass, whoever wrote it."""
    if not row or row.get("nav") is None:
        return False
    if not _ISO_RE.fullmatch(str(row.get("nav_date") or "")):
        return False
    if row.get("nav_date") == _today_iso():
        return True
    fa = _parse_utc(row.get("fetched_at"))
    return bool(fa) and (datetime.now(timezone.utc) - fa).total_seconds() < _FRESH_FOR


def _fetch_latest_from_mfapi(scheme_code: int) -> Optional[tuple[float, str, str]]:
    """(nav, nav_date_iso, scheme_name) from mfapi's /latest, or None on failure.

    mfapi returns nav_date as 'dd-mm-YYYY'; we normalize to ISO for comparison.
    """
    try:
        r = httpx.get(_MFAPI.format(code=scheme_code), timeout=12)
        r.raise_for_status()
        j = r.json()
        data = (j.get("data") or [])
        if not data:
            return None
        nav = float(data[0]["nav"])
        raw = data[0].get("date") or ""
        try:
            nav_date = datetime.strptime(raw, "%d-%m-%Y").date().isoformat()
        except ValueError:
            nav_date = _today_iso()
        name = (j.get("meta") or {}).get("scheme_name") or ""
        return nav, nav_date, name
    except Exception:
        return None


def _read_row(scheme_code: int) -> Optional[dict]:
    try:
        rows = _sb().table("scheme_nav_cache").select(
            "scheme_code,nav,nav_date,scheme_name,fetched_at").eq(
            "scheme_code", scheme_code).limit(1).execute().data or []
        return rows[0] if rows else None
    except Exception:
        return None


def _read_rows(codes: list[int]) -> dict[int, dict]:
    """Several schemes' cached rows in ONE round-trip (vs one query each)."""
    if not codes:
        return {}
    try:
        rows = _sb().table("scheme_nav_cache").select(
            "scheme_code,nav,nav_date,scheme_name,fetched_at").in_(
            "scheme_code", list(codes)).execute().data or []
        return {int(r["scheme_code"]): r for r in rows}
    except Exception:
        return {}


def _upsert(scheme_code: int, nav: float, nav_date: str, name: str) -> None:
    try:
        _sb().table("scheme_nav_cache").upsert({
            "scheme_code": scheme_code, "nav": nav, "nav_date": nav_date,
            "scheme_name": name or None,
            "fetched_at": datetime.utcnow().isoformat(),
        }, on_conflict="scheme_code").execute()
    except Exception:
        pass


def get_nav_meta(scheme_code: Optional[int], _row: object = ...) -> Optional[dict]:
    """The latest published NAV for a scheme WITH its freshness:
    ``{"nav", "nav_date" (ISO, the AMC's publish date), "fetched_at" (ISO UTC,
    when we last pulled it)}``.

    Never waits on AMFI when it doesn't have to: a stale cached row is served AS
    IS and refreshed in the background (the refresher thread keeps every held
    scheme current anyway). Only a scheme with NO row at all is fetched inline.
    ``_row`` lets prewarm pass a row it already read in its batch query.
    """
    if not scheme_code:
        return None
    scheme_code = int(scheme_code)

    now = time.time()
    m = _memo.get(scheme_code)
    if m and now - m[0] < _MEMO_TTL:
        return m[1]

    row = _read_row(scheme_code) if _row is ... else _row
    nav: Optional[float] = float(row["nav"]) if (row and row.get("nav") is not None) else None
    nav_date: Optional[str] = (row or {}).get("nav_date")
    fetched_at: Optional[str] = (row or {}).get("fetched_at")
    if not _is_fresh(row):
        if nav is None:
            latest = _fetch_latest(scheme_code)
            if latest:
                nav, nav_date, name = latest
                fetched_at = datetime.utcnow().isoformat()
                _upsert(scheme_code, nav, nav_date, name)
            # if every source failed there is simply no NAV (callers fall back)
        else:
            _kick_refresh()

    meta = {"nav": nav, "nav_date": nav_date, "fetched_at": fetched_at}
    _memo[scheme_code] = (now, meta)
    return meta


def get_nav(scheme_code: Optional[int]) -> Optional[float]:
    """The latest published NAV for a scheme (float only) — see get_nav_meta."""
    m = get_nav_meta(scheme_code)
    return m.get("nav") if m else None


def next_refresh_iso(now: Optional[datetime] = None) -> str:
    """When the NEXT daily NAV refresh lands: the next 01:00 IST (the cron time,
    just after the AMCs publish). ISO with the +05:30 offset so the app can show
    it in the user's clock."""
    now = (now or datetime.now(timezone.utc)).astimezone(IST)
    nxt = now.replace(hour=REFRESH_HOUR_IST, minute=0, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return nxt.isoformat()


def freshness(scheme_codes: list) -> dict:
    """Portfolio-level freshness for the app's status line, aggregated across
    the held schemes (all memoised by the prewarm/get_nav calls that precede it):

      nav_date     — the OLDEST publish date among the held NAVs (the value is
                     only as fresh as its stalest input)
      fetched_at   — the most recent time any of them was pulled from mfapi (UTC)
      refreshed_at — right now (UTC): when this response was computed
      next_refresh — the next 01:00 IST cron
    """
    dates, fetched = [], []
    for c in {int(x) for x in scheme_codes if x}:
        m = get_nav_meta(c)
        if not m:
            continue
        if m.get("nav_date"):
            dates.append(m["nav_date"])
        if m.get("fetched_at"):
            fetched.append(m["fetched_at"])
    return {
        "nav_date": min(dates) if dates else None,
        "fetched_at": max(fetched) if fetched else None,
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "next_refresh": next_refresh_iso(),
    }


def prewarm(scheme_codes: list[int]) -> None:
    """Populate the per-worker memo for several schemes with ONE batched DB read,
    so the subsequent per-holding get_nav() calls are all in-memory."""
    codes = [c for c in {int(x) for x in scheme_codes if x}
             if not (c in _memo and time.time() - _memo[c][0] < _MEMO_TTL)]
    if not codes:
        return
    rows = _read_rows(codes)
    missing = [c for c in codes if c not in rows]
    for c in codes:
        if c in rows:
            get_nav_meta(c, rows[c])
    if missing:   # never seen before — fetch those inline, concurrently
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(8, len(missing))) as ex:
            list(ex.map(lambda c: get_nav_meta(c, None), missing))


# ---------------------------------------------------------------------------
# PREVIOUS NAV — for the day's change (units × (NAV − previous NAV)).
# The cache table holds only the latest NAV, so the one before it comes from
# mfapi's dated history, sliced to the last few weeks (~600 bytes a scheme).
# Kept per worker, keyed by the NAV date it precedes, and warmed by the
# refresher — so the home never waits on it.
# ---------------------------------------------------------------------------
_MFAPI_RANGE = "https://api.mfapi.in/mf/{code}?startDate={start}&endDate={end}"
# { scheme_code: (for_nav_date, prev_nav, prev_nav_date) }
_prev: dict[int, tuple[str, float, str]] = {}


def prev_nav(scheme_code: Optional[int], nav_date: Optional[str]) -> Optional[tuple[float, str]]:
    """(nav, date) of the published NAV just before ``nav_date``, if known."""
    if not scheme_code or not nav_date:
        return None
    hit = _prev.get(int(scheme_code))
    return (hit[1], hit[2]) if hit and hit[0] == nav_date else None


def _load_prev(scheme_code: int, nav_date: str) -> None:
    try:
        start = (date.fromisoformat(nav_date) - timedelta(days=21)).isoformat()
        r = httpx.get(_MFAPI_RANGE.format(code=scheme_code, start=start, end=nav_date), timeout=10)
        r.raise_for_status()
        best: Optional[tuple[str, float]] = None
        for pt in r.json().get("data") or []:
            try:
                d = datetime.strptime(pt["date"], "%d-%m-%Y").date().isoformat()
                v = float(pt["nav"])
            except (KeyError, ValueError):
                continue
            # mfapi can lag AMFI by a day — "previous" is simply the latest
            # point strictly before the NAV date we're showing
            if d < nav_date and (best is None or d > best[0]):
                best = (d, v)
        if best:
            _prev[int(scheme_code)] = (nav_date, best[1], best[0])
    except Exception:
        pass


def ensure_prev(pairs: dict[int, str], timeout: float = 4.0) -> None:
    """Make sure prev_nav() can answer for each {scheme_code: nav_date}. Warm
    schemes cost nothing; missing ones are fetched concurrently, bounded by
    ``timeout`` so a slow mfapi can never hold up the home screen."""
    todo = [(int(c), d) for c, d in pairs.items() if c and d and prev_nav(c, d) is None]
    if not todo:
        return
    from concurrent.futures import ThreadPoolExecutor, wait
    ex = ThreadPoolExecutor(max_workers=min(8, len(todo)))
    futs = [ex.submit(_load_prev, c, d) for c, d in todo]
    wait(futs, timeout=timeout)
    ex.shutdown(wait=False)


# ---------------------------------------------------------------------------
# BACKGROUND REFRESHER — keeps every held scheme's NAV (and the NAV before it)
# current in the memo + DB, so requests only ever read memory.
# ---------------------------------------------------------------------------
_REFRESH_EVERY = 10 * 60
_kick = threading.Event()
_refresher_started = False


def _kick_refresh() -> None:
    """Ask the refresher to run now (a request saw a stale row)."""
    _kick.set()


def refresh_held_once() -> None:
    """One refresher pass: pull AMFI's file, upsert every held scheme whose
    NAV moved (or whose row is stale), refresh the memo, warm previous NAVs."""
    codes = held_scheme_codes()
    if not codes:
        return
    snap = _amfi_snapshot(force=True)
    rows = _read_rows(codes)
    now = time.time()
    for c in codes:
        row = rows.get(c)
        hit = snap.get(c)
        if hit:
            nav, nav_date = hit
            if not _is_fresh(row) or row.get("nav_date") != nav_date or float(row.get("nav") or 0) != nav:
                _upsert(c, nav, nav_date, (row or {}).get("scheme_name") or "")
                row = {"nav": nav, "nav_date": nav_date, "fetched_at": datetime.utcnow().isoformat()}
        elif not _is_fresh(row):
            latest = _fetch_latest_from_mfapi(c)
            if latest:
                _upsert(c, latest[0], latest[1], latest[2] or (row or {}).get("scheme_name") or "")
                row = {"nav": latest[0], "nav_date": latest[1], "fetched_at": datetime.utcnow().isoformat()}
        if row and row.get("nav") is not None:
            _memo[c] = (now, {"nav": float(row["nav"]), "nav_date": row.get("nav_date"),
                              "fetched_at": row.get("fetched_at")})
    ensure_prev({c: _memo[c][1]["nav_date"] for c in codes if c in _memo}, timeout=20)


def start_refresher() -> None:
    """Start the per-worker refresher thread (idempotent)."""
    global _refresher_started
    if _refresher_started:
        return
    _refresher_started = True

    def loop():
        while True:
            try:
                refresh_held_once()
            except Exception:
                pass
            _kick.wait(_REFRESH_EVERY)
            _kick.clear()
            time.sleep(5)   # a burst of stale reads → one pass, not many

    threading.Thread(target=loop, daemon=True, name="nav-refresher").start()


def refresh_all(scheme_codes: list[int]) -> dict:
    """Force-refresh every given scheme from mfapi into the DB cache. Used by the
    daily cron. Returns a small summary. Skips schemes already stamped today so a
    re-run is cheap."""
    updated = skipped = failed = 0
    today = _today_iso()
    for code in sorted({c for c in scheme_codes if c}):
        row = _read_row(code)
        if row and row.get("nav_date") == today and row.get("nav") is not None:
            skipped += 1
            continue
        latest = _fetch_latest(code)
        if latest:
            nav, nav_date, name = latest
            _upsert(code, nav, nav_date, name or (row or {}).get("scheme_name") or "")
            updated += 1
        else:
            failed += 1
    _memo.clear()
    return {"updated": updated, "skipped": skipped, "failed": failed,
            "total": updated + skipped + failed}


def held_scheme_codes() -> list[int]:
    """Every scheme_code the app needs a NAV for — client holdings + villa bucket
    funds. The cron refreshes exactly these (resource-efficient: only what's used)."""
    codes: set[int] = set()
    try:
        for t in ("client_holdings", "villa_bucket_funds"):
            rows = _sb().table(t).select("scheme_code").execute().data or []
            for r in rows:
                c = r.get("scheme_code")
                if c:
                    codes.add(int(c))
    except Exception:
        pass
    return sorted(codes)
