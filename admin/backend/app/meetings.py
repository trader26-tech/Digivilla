"""Meeting room + the admin's own meeting schedule (admin home → "Meeting room").

* The ROOM is one fixed Google Meet link the admin starts calls in and shares
  with clients. It defaults to settings.meet_link and can be changed from the
  admin home; client consultation bookings use the same room (bookings.py).
* MEETINGS are calls the admin schedules by hand (title, who, when, how long,
  note). They are kept forever — done/cancelled ones become the history.

Both live in the existing `admin_config` key/value table (keys `meet_room` and
`meetings`), so no migration is needed; without Supabase they fall back to
local JSON under app/data/, same as availability.py.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_ROOM_KEY = "meet_room"
_MEETINGS_KEY = "meetings"
_TABLE = "admin_config"

STATUSES = ("scheduled", "done", "cancelled")
_MAX_NOTE = 2000


# ── storage (admin_config row, else local JSON) ──────────────────────────────
def _read(key: str) -> dict:
    from app import availability

    if availability._use_supabase():
        from app.supabase_client import get_supabase

        rows = (
            get_supabase().table(_TABLE).select("value").eq("key", key).limit(1).execute().data or []
        )
        val = rows[0].get("value") if rows else None
        return val if isinstance(val, dict) else {}
    return availability._load(os.path.join(_DATA_DIR, f"{key}.json"), {}) or {}


def _write(key: str, value: dict) -> None:
    from app import availability

    if availability._use_supabase():
        from app.supabase_client import get_supabase

        # update-then-insert: admin_config may not have a unique key to upsert on
        tbl = get_supabase().table(_TABLE)
        if not (tbl.update({"value": value}).eq("key", key).execute().data or []):
            tbl.insert({"key": key, "value": value}).execute()
    else:
        availability._save(os.path.join(_DATA_DIR, f"{key}.json"), value)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── the room ─────────────────────────────────────────────────────────────────
def _default_room() -> str:
    try:
        from app.config import get_settings

        return (get_settings().meet_link or "").strip()
    except Exception:
        return ""


_room_cache: tuple[float, str] | None = None


def room() -> dict:
    stored = _read(_ROOM_KEY)
    url = (stored.get("url") or "").strip() or _default_room()
    return {"url": url, "is_default": not stored.get("url"), "updated_at": stored.get("updated_at")}


def room_url() -> str:
    """The room link, cached briefly — bookings._normalize calls this per row."""
    global _room_cache
    if _room_cache and time.monotonic() - _room_cache[0] < 60:
        return _room_cache[1]
    try:
        url = room()["url"]
    except Exception:
        url = _default_room()
    _room_cache = (time.monotonic(), url)
    return url


def normalize_url(raw: str) -> str:
    """'meet.google.com/abc-defg-hij' or a bare 'abc-defg-hij' code → full https link."""
    s = (raw or "").strip()
    if re.fullmatch(r"[a-z]{3}-[a-z]{4}-[a-z]{3}", s, re.I):
        s = f"https://meet.google.com/{s.lower()}"
    if s and not re.match(r"https?://", s, re.I):
        s = "https://" + s
    s = s.split("?")[0].rstrip("/") if "meet.google.com" in s else s
    if not re.fullmatch(r"https?://[^\s/$.?#][^\s]*", s):
        raise ValueError("That doesn't look like a link — paste the full Meet URL.")
    return s


def set_room(raw: str | None) -> dict:
    """Save a new room link; empty/None goes back to the default room."""
    global _room_cache
    url = normalize_url(raw) if (raw or "").strip() else ""
    _write(_ROOM_KEY, {"url": url, "updated_at": _now()} if url else {})
    _room_cache = None
    return room()


# ── meetings ─────────────────────────────────────────────────────────────────
def _all() -> list[dict]:
    items = _read(_MEETINGS_KEY).get("items")
    return items if isinstance(items, list) else []


def _save_all(items: list[dict]) -> None:
    items.sort(key=lambda m: m.get("starts_at") or "")
    _write(_MEETINGS_KEY, {"items": items})


def _parse_start(raw: str) -> str:
    """ISO datetime, stored with its offset (no offset = IST)."""
    s = (raw or "").strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Pick a date and time for the meeting.")
    if dt.tzinfo is None:
        dt = datetime.fromisoformat(s + "+05:30")
    return dt.isoformat(timespec="minutes")


def _clean(patch: dict, base: dict | None = None) -> dict:
    m = dict(base or {})
    if "title" in patch:
        m["title"] = (patch.get("title") or "").strip()[:120]
    if "with_name" in patch:
        m["with_name"] = (patch.get("with_name") or "").strip()[:120]
    if "with_phone" in patch:
        m["with_phone"] = re.sub(r"[^\d+]", "", patch.get("with_phone") or "")[:16]
    if "client_code" in patch:
        m["client_code"] = (patch.get("client_code") or "").strip()[:40] or None
    if "starts_at" in patch:
        m["starts_at"] = _parse_start(patch.get("starts_at") or "")
    if "duration_min" in patch:
        d = int(patch.get("duration_min") or 30)
        m["duration_min"] = max(5, min(d, 480))
    if "note" in patch:
        m["note"] = (patch.get("note") or "").strip()[:_MAX_NOTE]
    if "status" in patch:
        if patch["status"] not in STATUSES:
            raise ValueError("Unknown status.")
        m["status"] = patch["status"]
    if not (m.get("title") or m.get("with_name")):
        raise ValueError("Give the meeting a title or say who it's with.")
    if not m.get("starts_at"):
        raise ValueError("Pick a date and time for the meeting.")
    return m


def list_meetings() -> list[dict]:
    return _all()


def create(payload: dict) -> dict:
    m = _clean({"duration_min": 30, **payload})
    m.update(id=uuid.uuid4().hex[:12], status="scheduled", created_at=_now(), updated_at=_now())
    m.setdefault("note", "")
    items = _all()
    items.append(m)
    _save_all(items)
    return m


def update(meeting_id: str, patch: dict) -> dict | None:
    items = _all()
    for i, m in enumerate(items):
        if m.get("id") == meeting_id:
            items[i] = _clean(patch, m) | {"updated_at": _now()}
            _save_all(items)
            return items[i]
    return None


def delete(meeting_id: str) -> bool:
    items = _all()
    keep = [m for m in items if m.get("id") != meeting_id]
    if len(keep) == len(items):
        return False
    _save_all(keep)
    return True


def overview() -> dict:
    """Everything the home card needs: the room, the admin's meetings, and the
    consultation calls clients booked from the app (read-only here)."""
    from app import bookings as bookings_svc

    calls = []
    try:
        for b in bookings_svc.list_bookings():
            if b.kind == "consultation" and b.slot and b.status != "declined":
                calls.append({"id": b.id, "name": b.name, "phone": b.phone,
                              "starts_at": b.slot, "status": b.status, "note": b.note})
    except Exception:
        pass
    return {"room": room(), "meetings": list_meetings(), "client_calls": calls}
