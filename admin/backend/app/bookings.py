"""Consultation-booking persistence for the plot-reservation flow.

A user reserving a plot submits a preferred time slot; it's stored as a
`requested` booking. The admin dashboard lists all bookings and confirms or
declines each one. Storage mirrors goals.py: Supabase when configured, else a
local JSON file, so it works out of the box in development.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from app.schemas import Booking, BookingCreate

_LOCAL_PATH = os.path.join(os.path.dirname(__file__), "data", "bookings.json")


# ---------------- storage ----------------
_TABLE_OK = None  # None = unprobed, True/False = cached result


def _use_supabase() -> bool:
    """True only when Supabase is configured AND the `bookings` table exists.

    Probed once and cached. If the table is missing (fresh project that hasn't
    run the schema SQL yet), we fall back to local JSON instead of 500-ing —
    run supabase_setup.sql to persist bookings across restarts."""
    global _TABLE_OK
    if _TABLE_OK is not None:
        return _TABLE_OK
    try:
        from app.supabase_client import get_supabase

        get_supabase().table("bookings").select("id").limit(1).execute()
        _TABLE_OK = True
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in ("bookings", "does not exist", "pgrst205",
                                  "schema cache", "could not find", "not configured")):
            _TABLE_OK = False
        else:
            # Transient error (network, etc.) — don't cache; let it retry.
            return False
    return _TABLE_OK


def _read_local() -> list[dict]:
    if os.path.exists(_LOCAL_PATH):
        with open(_LOCAL_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    return []


def _write_local(rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(_LOCAL_PATH), exist_ok=True)
    with open(_LOCAL_PATH, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)


def _normalize(row: dict) -> dict:
    """Fill defaults for optional fields before building the Pydantic model."""
    kind = row.get("kind") or "consultation"
    if kind not in ("consultation", "sip", "buy", "withdraw"):
        kind = "consultation"
    return {
        "id": row.get("id", ""),
        "name": row.get("name", ""),
        "phone": row.get("phone", ""),
        "kind": kind,
        "property": row.get("property", "land"),
        "variant": row.get("variant", ""),
        "plots": int(row.get("plots", 1) or 1),
        "amount": float(row.get("amount", 0) or 0),
        "slot": row.get("slot", "") or "",
        "note": row.get("note", ""),
        "status": row.get("status", "requested"),
        "meet_link": row.get("meet_link", "") or "",
        "created_at": row.get("created_at", ""),
    }


# ---------------- operations ----------------

def create_booking(payload: BookingCreate) -> Booking:
    row = payload.model_dump()
    row["id"] = uuid.uuid4().hex
    row["status"] = "requested"
    row["created_at"] = datetime.now(timezone.utc).isoformat()

    if _use_supabase():
        from app.supabase_client import get_supabase

        get_supabase().table("bookings").insert(row).execute()
    else:
        rows = _read_local()
        rows.append(row)
        _write_local(rows)
    return Booking(**_normalize(row))


def list_bookings() -> list[Booking]:
    if _use_supabase():
        from app.supabase_client import get_supabase

        rows = get_supabase().table("bookings").select("*").execute().data or []
    else:
        rows = _read_local()
    # Order by the requested slot time so the admin calendar reads chronologically.
    rows.sort(key=lambda r: r.get("slot", ""))
    return [Booking(**_normalize(r)) for r in rows]


def confirmed_slots() -> list[str]:
    """ISO slot strings that are already CONFIRMED consultations — used to grey
    them out in the user's picker so two people can't book the same time.
    SIP/buy/withdraw requests carry no slot, so they never block the picker."""
    return [b.slot for b in list_bookings()
            if b.status == "confirmed" and b.kind == "consultation" and b.slot]


def set_status(booking_id: str, status: str) -> Booking | None:
    status = status if status in ("requested", "confirmed", "declined") else "requested"
    if _use_supabase():
        from app.supabase_client import get_supabase

        res = (
            get_supabase()
            .table("bookings")
            .update({"status": status})
            .eq("id", booking_id)
            .execute()
        )
        rows = res.data or []
        return Booking(**_normalize(rows[0])) if rows else None

    rows = _read_local()
    found: dict | None = None
    for r in rows:
        if r.get("id") == booking_id:
            r["status"] = status
            found = r
            break
    if found is None:
        return None
    _write_local(rows)
    return Booking(**_normalize(found))


def set_meet_link(booking_id: str, meet_link: str) -> Booking | None:
    """Attach (or clear) a Google Meet / video link on a booking."""
    meet_link = (meet_link or "").strip()
    if _use_supabase():
        from app.supabase_client import get_supabase

        res = (
            get_supabase()
            .table("bookings")
            .update({"meet_link": meet_link})
            .eq("id", booking_id)
            .execute()
        )
        rows = res.data or []
        return Booking(**_normalize(rows[0])) if rows else None

    rows = _read_local()
    found: dict | None = None
    for r in rows:
        if r.get("id") == booking_id:
            r["meet_link"] = meet_link
            found = r
            break
    if found is None:
        return None
    _write_local(rows)
    return Booking(**_normalize(found))


def delete_booking(booking_id: str) -> bool:
    if _use_supabase():
        from app.supabase_client import get_supabase

        get_supabase().table("bookings").delete().eq("id", booking_id).execute()
        return True
    rows = _read_local()
    new = [r for r in rows if r.get("id") != booking_id]
    _write_local(new)
    return len(new) != len(rows)
