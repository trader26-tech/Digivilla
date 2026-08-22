"""Goal persistence + progress, for the Home monitoring screen.

Goals are saved to Supabase (`goals` table) when configured, otherwise to a
local JSON file so the feature works out-of-the-box in development. Progress is
computed from the plan itself (target, monthly SIP, expected return, elapsed
time) — no real brokerage holdings required.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from app.schemas import Goal, GoalCreate, GoalProgress

_LOCAL_PATH = os.path.join(os.path.dirname(__file__), "data", "goals.json")


# ---------------- storage ----------------

def _use_supabase() -> bool:
    """True only when Supabase is actually configured and reachable."""
    try:
        from app.supabase_client import get_supabase

        get_supabase()  # raises RuntimeError if not configured
        return True
    except Exception:
        return False


def _read_local() -> list[dict]:
    if os.path.exists(_LOCAL_PATH):
        with open(_LOCAL_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    return []


def _write_local(rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(_LOCAL_PATH), exist_ok=True)
    with open(_LOCAL_PATH, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)


def list_goals(owner: str | None = None) -> list[Goal]:
    rows: list[dict]
    if _use_supabase():
        from app.supabase_client import get_supabase

        q = get_supabase().table("goals").select("*")
        if owner:
            q = q.eq("owner", owner)
        rows = q.execute().data or []
    else:
        rows = _read_local()
        if owner:
            rows = [r for r in rows if r.get("owner") == owner]
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return [Goal(**_normalize(r)) for r in rows]


def create_goal(payload: GoalCreate) -> Goal:
    row = payload.model_dump()
    row["id"] = uuid.uuid4().hex
    row["created_at"] = datetime.now(timezone.utc).isoformat()

    if _use_supabase():
        from app.supabase_client import get_supabase

        get_supabase().table("goals").insert(row).execute()
    else:
        rows = _read_local()
        rows.append(row)
        _write_local(rows)
    return Goal(**_normalize(row))


def delete_goal(goal_id: str, owner: str | None = None) -> bool:
    if _use_supabase():
        from app.supabase_client import get_supabase

        q = get_supabase().table("goals").delete().eq("id", goal_id)
        if owner:
            q = q.eq("owner", owner)
        q.execute()
        return True
    rows = _read_local()
    new = [r for r in rows if not (r["id"] == goal_id and (owner is None or r.get("owner") == owner))]
    _write_local(new)
    return len(new) != len(rows)


def _normalize(row: dict) -> dict:
    row = dict(row)
    row.setdefault("recommendations", [])
    row.setdefault("owner", None)
    return row


# ---------------- progress ----------------

def compute_progress(goal: Goal) -> GoalProgress:
    created = _parse_iso(goal.created_at)
    now = datetime.now(timezone.utc)
    months_elapsed = max(
        0,
        (now.year - created.year) * 12 + (now.month - created.month),
    )
    months_total = max(1, round(goal.horizon_years * 12))
    months_elapsed = min(months_elapsed, months_total)

    monthly = goal.monthly_investment
    invested = monthly * months_elapsed

    # On-track (median) future value of a monthly SIP after `months_elapsed`
    # months at the plan's expected return.
    r_month = (1 + goal.expected_return) ** (1 / 12) - 1
    if r_month > 0 and months_elapsed > 0:
        on_track = monthly * (((1 + r_month) ** months_elapsed - 1) / r_month)
    else:
        on_track = invested

    target = goal.target_amount
    progress_pct = (invested / target * 100) if target > 0 else 0
    on_track_pct = (on_track / target * 100) if target > 0 else 0

    if months_elapsed == 0:
        status = "new"
    else:
        # Compare actual plan progress to where it should be — since we don't
        # have real holdings, "on_track" is the plan's own expectation, so a
        # freshly-saved goal following its plan is by definition on track.
        status = "on_track"

    return GoalProgress(
        months_elapsed=months_elapsed,
        months_total=months_total,
        invested_so_far=round(invested),
        on_track_value=round(on_track),
        target_amount=round(target),
        progress_percent=round(progress_pct, 1),
        on_track_percent=round(on_track_pct, 1),
        status=status,
    )


def _parse_iso(s: str) -> datetime:
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return datetime.now(timezone.utc)
