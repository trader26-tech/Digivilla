"""Daily NAV cache — the app's source of current mutual-fund NAVs.

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
from datetime import date, datetime
from typing import Optional

import httpx


_MEMO_TTL = 300  # seconds — a per-worker read memo, NOT the source of truth
_memo: dict[int, tuple[float, Optional[float], Optional[str]]] = {}

_MFAPI = "https://api.mfapi.in/mf/{code}/latest"


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
            "scheme_code,nav,nav_date,scheme_name").eq(
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


def get_nav(scheme_code: Optional[int]) -> Optional[float]:
    """The latest published NAV for a scheme, from the DB cache.

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
    if not fresh:
        latest = _fetch_latest_from_mfapi(scheme_code)
        if latest:
            nav, nav_date, name = latest
            _upsert(scheme_code, nav, nav_date, name or (row or {}).get("scheme_name") or "")
        # if mfapi failed, keep the last-known DB nav (better stale than blank)

    _memo[scheme_code] = (now, nav, None)
    return nav


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
        latest = _fetch_latest_from_mfapi(code)
        if latest:
            nav, nav_date, name = latest
            _upsert(code, nav, nav_date, name)
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
