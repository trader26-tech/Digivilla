"""Website metrics for thedigiciti.com — who sees the site, who opens Explore, who taps WhatsApp.

The site sends a beacon (POST /site/t, text/plain JSON, no cookies) for three events:
  view      a page loaded
  explore   Explore opened (the phone lesson, explore.html, or the Story from the desktop button)
  whatsapp  a tap on the WhatsApp group link
Each carries an anonymous id kept in the visitor's localStorage, so "people" = distinct ids.

Stored per day in admin_config under `site:YYYY-MM-DD` (no migration): counts, the distinct ids
per event (capped), pages and referrer hosts. Reads aggregate any range.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

from zoneinfo import ZoneInfo

EVENTS = ("view", "explore", "whatsapp")
CAP_IDS = 20000
IST = ZoneInfo("Asia/Kolkata")
_LOCK = threading.Lock()
_MEM: dict = {}                     # day → doc (write-through cache)
_PENDING: set = set()               # days changed since the last flush
_LAST_FLUSH = [0.0]


def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def _key(day: str) -> str:
    return f"site:{day}"


def _blank(day: str) -> dict:
    return {"day": day, "counts": {e: 0 for e in EVENTS}, "ids": {e: [] for e in EVENTS}, "pages": {}, "refs": {}}


def _load(day: str) -> dict:
    if day in _MEM:
        return _MEM[day]
    doc = None
    try:
        rows = _sb().table("admin_config").select("value").eq("key", _key(day)).limit(1).execute().data or []
        doc = rows[0]["value"] if rows and isinstance(rows[0].get("value"), dict) else None
    except Exception:
        doc = None
    doc = doc or _blank(day)
    for e in EVENTS:
        doc.setdefault("counts", {}).setdefault(e, 0)
        doc.setdefault("ids", {}).setdefault(e, [])
    doc.setdefault("pages", {}); doc.setdefault("refs", {})
    _MEM[day] = doc
    return doc


def _flush(force: bool = False) -> None:
    """Write changed days back (at most every 5 s unless forced) — one row per day."""
    if not _PENDING or (not force and time.time() - _LAST_FLUSH[0] < 5):
        return
    days = list(_PENDING)
    _PENDING.clear()
    _LAST_FLUSH[0] = time.time()
    cl = _sb()
    for d in days:
        try:
            cl.table("admin_config").delete().eq("key", _key(d)).execute()
            cl.table("admin_config").insert({"key": _key(d), "value": _MEM[d]}).execute()
        except Exception:
            _PENDING.add(d)


def record(body: dict, ua: str = "") -> None:
    e = str((body or {}).get("e") or "")
    if e not in EVENTS:
        return
    vid = str(body.get("v") or "")[:40] or "anon"
    if any(b in (ua or "").lower() for b in ("bot", "crawler", "spider", "headless", "preview", "lighthouse")):
        return
    day = datetime.now(IST).date().isoformat()
    with _LOCK:
        doc = _load(day)
        doc["counts"][e] += 1
        ids = doc["ids"][e]
        if vid not in ids and len(ids) < CAP_IDS:
            ids.append(vid)
        if e == "view":
            p = (str(body.get("p") or "/")[:60]) or "/"
            doc["pages"][p] = doc["pages"].get(p, 0) + 1
            ref = str(body.get("r") or "")
            host = urlparse(ref).hostname or ("direct" if not ref else "other")
            if host and not host.endswith("thedigiciti.com") and not host.endswith("thedigicity.in"):
                host = host.replace("www.", "")[:40]
                doc["refs"][host] = doc["refs"].get(host, 0) + 1
        _PENDING.add(day)
        _flush()


def summary(days: int = 30) -> dict:
    """Distinct people and counts per event over the last `days` days (IST), the daily series,
    the funnel (of the people who saw the site, how many opened Explore / tapped WhatsApp)."""
    with _LOCK:
        _flush(force=True)
    days = max(1, min(366, int(days)))
    today = datetime.now(IST).date()
    series, uniq = [], {e: set() for e in EVENTS}
    counts = {e: 0 for e in EVENTS}
    pages: dict = {}
    refs: dict = {}
    for k in range(days - 1, -1, -1):
        d = (today - timedelta(days=k)).isoformat()
        doc = _MEM.get(d) if d == today.isoformat() else None
        if doc is None:
            try:
                rows = _sb().table("admin_config").select("value").eq("key", _key(d)).limit(1).execute().data or []
                doc = rows[0]["value"] if rows and isinstance(rows[0].get("value"), dict) else _blank(d)
            except Exception:
                doc = _blank(d)
        row = {"day": d}
        for e in EVENTS:
            ids = set((doc.get("ids") or {}).get(e) or [])
            uniq[e] |= ids
            counts[e] += int((doc.get("counts") or {}).get(e) or 0)
            row[e] = len(ids)
        series.append(row)
        for p, n in (doc.get("pages") or {}).items():
            pages[p] = pages.get(p, 0) + n
        for h, n in (doc.get("refs") or {}).items():
            refs[h] = refs.get(h, 0) + n
    seen = len(uniq["view"] | uniq["explore"] | uniq["whatsapp"])
    people = {e: len(uniq[e]) for e in EVENTS}
    return {
        "days": days, "from": series[0]["day"], "to": series[-1]["day"],
        "visitors": seen, "people": people, "counts": counts,
        "explore_pct": round(people["explore"] / seen * 100, 1) if seen else 0.0,
        "whatsapp_pct": round(people["whatsapp"] / seen * 100, 1) if seen else 0.0,
        "whatsapp_of_explore_pct": round(len(uniq["whatsapp"] & uniq["explore"]) / people["explore"] * 100, 1) if people["explore"] else 0.0,
        "series": series,
        "pages": sorted(({"page": p, "views": n} for p, n in pages.items()), key=lambda x: -x["views"])[:10],
        "refs": sorted(({"source": h, "visits": n} for h, n in refs.items()), key=lambda x: -x["visits"])[:10],
    }
