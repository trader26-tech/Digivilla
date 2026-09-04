"""Admin availability: working-hours config + per-day 30-minute slots.

The admin sets a weekly working window (e.g. 10:00–18:00). Each day in that
window is split into 30-minute slots. Every slot is FREE by default; the admin
can BLOCK individual slots (busy, personal, held). Clients only ever see free
slots (a blocked slot is greyed out in their picker, alongside confirmed
bookings — see main.py `/bookings/taken`).

Storage mirrors bookings.py: Supabase when configured (tables `admin_config`,
`admin_blocked_slots`), else local JSON under app/data/ so dev works with zero
setup. A "blocked slot" is just an ISO-8601 slot string the admin marked busy.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_CONFIG_JSON = os.path.join(_DATA_DIR, "admin_config.json")
_BLOCKED_JSON = os.path.join(_DATA_DIR, "admin_blocked.json")

_CONFIG_TABLE = "admin_config"
_BLOCKED_TABLE = "admin_blocked_slots"
_CONFIG_KEY = "availability"  # single row keyed by this

# Default working window (24h "HH:MM"), slot length, and which weekdays are on.
# weekdays: 0 = Mon … 6 = Sun (Python's date.weekday()).
DEFAULT_CONFIG = {
    "start": "10:00",
    "end": "18:00",
    "slot_minutes": 30,
    "weekdays": [0, 1, 2, 3, 4, 5],  # Mon–Sat
    "tz_offset": "+05:30",           # IST; stamped onto every ISO slot
}


# ── storage helpers ──────────────────────────────────────────────────────────
_TABLE_OK = None  # None = unprobed


def _use_supabase() -> bool:
    """True only when Supabase is configured AND the admin_config table exists;
    otherwise fall back to local JSON (see bookings.py for the same pattern)."""
    global _TABLE_OK
    if _TABLE_OK is not None:
        return _TABLE_OK
    try:
        from app.supabase_client import get_supabase

        get_supabase().table(_CONFIG_TABLE).select("key").limit(1).execute()
        _TABLE_OK = True
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in (_CONFIG_TABLE, "does not exist", "pgrst205",
                                  "schema cache", "could not find", "not configured")):
            _TABLE_OK = False
        else:
            return False
    return _TABLE_OK


def _load(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save(path: str, data) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ── config (working window) ──────────────────────────────────────────────────
def get_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if _use_supabase():
        try:
            from app.supabase_client import get_supabase

            rows = (
                get_supabase().table(_CONFIG_TABLE)
                .select("value").eq("key", _CONFIG_KEY).limit(1).execute().data or []
            )
            if rows and isinstance(rows[0].get("value"), dict):
                cfg.update(rows[0]["value"])
        except Exception:
            pass
    else:
        stored = _load(_CONFIG_JSON, {})
        if isinstance(stored, dict):
            cfg.update(stored)
    return cfg


def set_config(patch: dict) -> dict:
    cfg = get_config()
    for k in ("start", "end", "slot_minutes", "weekdays", "tz_offset"):
        if k in patch and patch[k] is not None:
            cfg[k] = patch[k]
    if _use_supabase():
        from app.supabase_client import get_supabase

        cl = get_supabase()
        cl.table(_CONFIG_TABLE).delete().eq("key", _CONFIG_KEY).execute()
        cl.table(_CONFIG_TABLE).insert({"key": _CONFIG_KEY, "value": cfg}).execute()
    else:
        _save(_CONFIG_JSON, cfg)
    return cfg


# ── blocked slots ────────────────────────────────────────────────────────────
def blocked_slots() -> list[str]:
    if _use_supabase():
        try:
            from app.supabase_client import get_supabase

            rows = get_supabase().table(_BLOCKED_TABLE).select("slot").execute().data or []
            return [r.get("slot", "") for r in rows if r.get("slot")]
        except Exception:
            return []
    return list(_load(_BLOCKED_JSON, []))


def set_blocked(slot: str, blocked: bool) -> None:
    slot = (slot or "").strip()
    if not slot:
        return
    if _use_supabase():
        from app.supabase_client import get_supabase

        cl = get_supabase()
        if blocked:
            cl.table(_BLOCKED_TABLE).delete().eq("slot", slot).execute()  # de-dup
            cl.table(_BLOCKED_TABLE).insert({"slot": slot}).execute()
        else:
            cl.table(_BLOCKED_TABLE).delete().eq("slot", slot).execute()
        return
    rows = set(_load(_BLOCKED_JSON, []))
    if blocked:
        rows.add(slot)
    else:
        rows.discard(slot)
    _save(_BLOCKED_JSON, sorted(rows))


# ── slot grid generation ─────────────────────────────────────────────────────
def _times(cfg: dict) -> list[str]:
    """List of "HH:MM" slot-start times across the working window."""
    def to_min(hhmm: str) -> int:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    start = to_min(cfg["start"])
    end = to_min(cfg["end"])
    step = int(cfg["slot_minutes"]) or 30
    out = []
    t = start
    while t < end:
        out.append(f"{t // 60:02d}:{t % 60:02d}")
        t += step
    return out


def slot_iso(day_iso: str, time_hm: str, cfg: dict | None = None) -> str:
    """`2026-09-05`,`14:30` → `2026-09-05T14:30:00+05:30`."""
    cfg = cfg or get_config()
    return f"{day_iso}T{time_hm}:00{cfg.get('tz_offset', '+05:30')}"


def day_grid(days: int = 14) -> list[dict]:
    """Upcoming `days` working days, each with its 30-min slots and their state
    (free / blocked). Used by the admin availability editor."""
    cfg = get_config()
    times = _times(cfg)
    blocked = set(blocked_slots())
    weekdays = set(cfg.get("weekdays", DEFAULT_CONFIG["weekdays"]))

    out: list[dict] = []
    today = datetime.now()
    for i in range(days):
        d = (today + timedelta(days=i)).date()
        if d.weekday() not in weekdays:
            continue
        iso = d.isoformat()
        slots = []
        for t in times:
            s = slot_iso(iso, t, cfg)
            slots.append({"time": t, "slot": s, "blocked": s in blocked})
        out.append({"date": iso, "weekday": d.weekday(), "slots": slots})
    return out
