"""Seed a demo account — Ranjeev / 8925188870 — with mutual-fund goals that
already have money invested, so the Home screen renders a full, lived-in
portfolio.

Why a script (not the API): `POST /goals` always stamps `created_at = now()`,
which makes every goal read as brand-new (0 invested, 0 months elapsed). Progress
(`invested_so_far`, `on_track_value`, `months_elapsed`) is derived purely from
`created_at`, so to show goals that have been running for months/years we insert
rows directly with a BACKDATED `created_at`.

It writes through the app's own storage layer, so it targets Supabase when
configured and the local JSON files otherwise — exactly like the running server.

Run from the backend dir with the venv active:
    python seed_ranjeev.py
Re-running is safe: it clears this demo owner's existing goals first.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

# --- fixed identity for the demo account -----------------------------------
# A stable owner id so the user row and all goals link up. Because phone login
# is find-or-create BY PHONE, logging in as 8925188870 returns THIS user (and
# therefore these goals).
OWNER = "usr_ranjeev_demo"
PHONE = "+918925188870"
NAME = "Ranjeev"
EMAIL = f"phone+{PHONE.lstrip('+')}@mylakshyas.local"


def _months_ago(n: int) -> str:
    """ISO-8601 timestamp roughly n months before now (30-day months)."""
    return (datetime.now(timezone.utc) - timedelta(days=int(n * 30.44))).isoformat()


def _rec(name: str, asset_class: str, weight: float, monthly: float) -> dict:
    return {
        "name": name,
        "asset_class": asset_class,
        "weight": round(weight, 4),
        "monthly_amount": round(monthly, 2),
    }


def _goal(
    *,
    key: str,
    label: str,
    target: float,
    horizon_years: float,
    risk: str,
    monthly: float,
    exp_return: float,
    started_months_ago: int,
    recommendations: list[dict],
) -> dict:
    """Build a full goals-table row with a backdated created_at."""
    return {
        "id": uuid.uuid4().hex,
        "goal": key,
        "label": label,
        "target_amount": float(target),
        "horizon_years": float(horizon_years),
        "resolved_risk": risk,
        "monthly_investment": float(monthly),
        "expected_return": float(exp_return),
        "projected_p50": round(target, 2),
        "projected_p10": round(target * 0.82, 2),
        "projected_p90": round(target * 1.24, 2),
        "success_rate": 0.86,
        "recommendations": recommendations,
        "owner": OWNER,
        "created_at": _months_ago(started_months_ago),
    }


# --- the demo goals ---------------------------------------------------------
# Real fund names from this app's universe. Weights sum to ~1.0 and each fund's
# monthly_amount sums to the goal's monthly SIP.
GOALS: list[dict] = [
    _goal(
        key="retirement",
        label="Retirement corpus",
        target=15_000_000,
        horizon_years=22,
        risk="aggressive",
        monthly=25_000,
        exp_return=0.125,
        started_months_ago=40,
        recommendations=[
            _rec("Motilal Oswal Flexi Cap Fund", "equity", 0.45, 11_250),
            _rec("Edelweiss Mid Cap Fund", "equity", 0.30, 7_500),
            _rec("HDFC Balanced Advantage Fund", "hybrid", 0.15, 3_750),
            _rec("ICICI Prudential Corporate Bond Fund", "debt", 0.10, 2_500),
        ],
    ),
    _goal(
        key="house",
        label="Dream home down payment",
        target=4_000_000,
        horizon_years=8,
        risk="balanced",
        monthly=22_000,
        exp_return=0.105,
        started_months_ago=26,
        recommendations=[
            _rec("Motilal Oswal Flexi Cap Fund", "equity", 0.40, 8_800),
            _rec("HDFC Balanced Advantage Fund", "hybrid", 0.35, 7_700),
            _rec("ICICI Prudential Corporate Bond Fund", "debt", 0.25, 5_500),
        ],
    ),
    _goal(
        key="education",
        label="Child's education",
        target=3_500_000,
        horizon_years=12,
        risk="balanced",
        monthly=15_000,
        exp_return=0.11,
        started_months_ago=18,
        recommendations=[
            _rec("Edelweiss Mid Cap Fund", "equity", 0.45, 6_750),
            _rec("Motilal Oswal Flexi Cap Fund", "equity", 0.30, 4_500),
            _rec("HDFC Balanced Advantage Fund", "hybrid", 0.25, 3_750),
        ],
    ),
    _goal(
        key="travel",
        label="World trip fund",
        target=800_000,
        horizon_years=3,
        risk="conservative",
        monthly=12_000,
        exp_return=0.08,
        started_months_ago=11,
        recommendations=[
            _rec("HDFC Balanced Advantage Fund", "hybrid", 0.40, 4_800),
            _rec("ICICI Prudential Corporate Bond Fund", "debt", 0.35, 4_200),
            _rec("ICICI Prudential Liquid Fund", "debt", 0.25, 3_000),
        ],
    ),
    _goal(
        key="emergency",
        label="Emergency fund",
        target=600_000,
        horizon_years=2,
        risk="conservative",
        monthly=15_000,
        exp_return=0.07,
        started_months_ago=14,
        recommendations=[
            _rec("ICICI Prudential Liquid Fund", "debt", 0.60, 9_000),
            _rec("ICICI Prudential Corporate Bond Fund", "debt", 0.40, 6_000),
        ],
    ),
]


# --- storage (mirrors app.goals / app.auth: Supabase else local JSON) -------

def _use_supabase() -> bool:
    try:
        from app.supabase_client import get_supabase

        get_supabase()
        return True
    except Exception:
        return False


def _upsert_user_supabase() -> None:
    from app.supabase_client import get_supabase

    sb = get_supabase()
    existing = sb.table("users").select("owner").eq("phone", PHONE).execute().data or []
    if existing:
        print(f"  user for {PHONE} already exists (owner={existing[0].get('owner')})")
        # keep our OWNER consistent with what's stored
        return existing[0].get("owner") or OWNER
    row = {
        "id": uuid.uuid4().hex,
        "owner": OWNER,
        "email": EMAIL,
        "phone": PHONE,
        "name": NAME,
        "salt": "",
        "password_hash": "",
    }
    sb.table("users").insert(row).execute()
    print(f"  inserted user {NAME} ({PHONE}) owner={OWNER}")
    return OWNER


def _seed_supabase() -> None:
    from app.supabase_client import get_supabase

    sb = get_supabase()
    owner = _upsert_user_supabase() or OWNER
    # clear any prior demo goals for this owner, then insert fresh
    sb.table("goals").delete().eq("owner", owner).execute()
    for g in GOALS:
        g["owner"] = owner
        sb.table("goals").insert(g).execute()
    print(f"  inserted {len(GOALS)} goals for owner={owner}")


def _seed_local() -> None:
    import json
    import os

    base = os.path.join(os.path.dirname(__file__), "app", "data")
    os.makedirs(base, exist_ok=True)
    users_path = os.path.join(base, "users.json")
    goals_path = os.path.join(base, "goals.json")

    users = json.load(open(users_path)) if os.path.exists(users_path) else []
    if not any(u.get("phone") == PHONE for u in users):
        users.append(
            {
                "id": uuid.uuid4().hex,
                "owner": OWNER,
                "email": EMAIL,
                "phone": PHONE,
                "name": NAME,
                "salt": "",
                "password_hash": "",
            }
        )
        json.dump(users, open(users_path, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"  inserted user {NAME} ({PHONE}) owner={OWNER}")
    else:
        print(f"  user for {PHONE} already exists")

    goals = json.load(open(goals_path)) if os.path.exists(goals_path) else []
    goals = [g for g in goals if g.get("owner") != OWNER]  # clear prior demo goals
    goals.extend(GOALS)
    json.dump(goals, open(goals_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  inserted {len(GOALS)} goals for owner={OWNER}")


def main() -> None:
    if _use_supabase():
        print("Seeding into Supabase…")
        _seed_supabase()
    else:
        print("Supabase not configured — seeding local JSON files…")
        _seed_local()
    print("Done. Log in with phone 8925188870 to see Ranjeev's portfolio.")


if __name__ == "__main__":
    main()
