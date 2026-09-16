"""Daily NAV cache — the app's source of current mutual-fund NAVs.

Source order: AMFI's own NAVAll.txt (authoritative, and typically hours ahead of
the mirrors), then api.mfapi.in as a per-scheme fallback.

Indian MF NAVs are published ONCE PER DAY by the AMCs (finalized ~11pm–1am IST)
and do not change intraday, so there is nothing to "stream": a persistent socket
per user would sit idle 24/7 for a single daily update. Instead we keep the
latest published NAV per scheme in the shared Supabase table ``scheme_nav_cache``
and read from it — instant, shared across workers, and it survives restarts.

Freshness is guaranteed two ways:
  1. A once-a-day Railway cron (``scripts/refresh_navs.py``) calls ``refresh_all``
     after the daily publish, updating every held scheme.
  2. Refresh-on-read safety net: if a scheme's cached ``nav_date`` is not today's
     (or missing), we refresh just that one scheme from mfapi on demand and
     upsert it — so even a missed cron self-heals within one request.

A tiny in-process memo (per worker, short TTL) avoids re-reading the DB for the
same scheme within a single request burst.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx


_MEMO_TTL = 300  # seconds — a per-worker read memo, NOT the source of truth
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


def _amfi_snapshot() -> dict[int, tuple[float, str]]:
    """{scheme_code: (nav, nav_date_iso)} for every scheme AMFI publishes.

    Cached per worker for _AMFI_TTL. On any failure returns the last good
    snapshot (or {}), so a network blip just falls through to mfapi.
    """
    global _amfi_snap
    now = time.time()
    if _amfi_snap[1] and now - _amfi_snap[0] < _AMFI_TTL:
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
    return date.today().isoformat()


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


def _upsert(scheme_code: int, nav: float, nav_date: str, name: str) -> None:
    try:
        _sb().table("scheme_nav_cache").upsert({
            "scheme_code": scheme_code, "nav": nav, "nav_date": nav_date,
            "scheme_name": name or None,
            "fetched_at": datetime.utcnow().isoformat(),
        }, on_conflict="scheme_code").execute()
    except Exception:
        pass


def get_nav_meta(scheme_code: Optional[int]) -> Optional[dict]:
    """The latest published NAV for a scheme WITH its freshness:
    ``{"nav", "nav_date" (ISO, the AMC's publish date), "fetched_at" (ISO UTC,
    when we last pulled it from mfapi)}``.

    Refresh-on-read: if the cached row is missing or its nav_date isn't today,
    fetch the latest from mfapi once and upsert it. NAVs don't change intraday,
    so a row already stamped with today's date is returned as-is (no fetch).
    """
    if not scheme_code:
        return None

    now = time.time()
    m = _memo.get(scheme_code)
    if m and now - m[0] < _MEMO_TTL:
        return m[1]

    row = _read_row(scheme_code)
    fresh = bool(row and row.get("nav_date") == _today_iso() and row.get("nav") is not None)

    nav: Optional[float] = float(row["nav"]) if (row and row.get("nav") is not None) else None
    nav_date: Optional[str] = (row or {}).get("nav_date")
    fetched_at: Optional[str] = (row or {}).get("fetched_at")
    if not fresh:
        latest = _fetch_latest(scheme_code)
        if latest:
            nav, nav_date, name = latest
            fetched_at = datetime.utcnow().isoformat()
            _upsert(scheme_code, nav, nav_date, name or (row or {}).get("scheme_name") or "")
        # if mfapi failed, keep the last-known DB nav (better stale than blank)

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
    """Populate the per-worker memo for several schemes CONCURRENTLY, so the
    subsequent per-holding get_nav() calls are all in-memory. On a cold worker
    this turns N sequential refresh-on-read fetches into ~one round-trip."""
    codes = [c for c in {int(x) for x in scheme_codes if x} if c not in _memo]
    if not codes:
        return
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(8, len(codes))) as ex:
        list(ex.map(get_nav, codes))


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
