"""The client's REAL portfolio — units × live NAV, bridged to their login by phone.

SINGLE SOURCE OF TRUTH: the admin uploads a daily Transaction Report which is
parsed into ``client_holdings`` (units + resolved mfapi ``scheme_code`` + invested
per scheme), keyed by ``client_code``. ``client_master`` maps that code to a name
and PHONE. A client logs in by phone, so we bridge:

    users.owner  →  users.phone  →  (last-10-digit match)  client_master.phone
                 →  client_code  →  client_holdings

Portfolio worth is then Σ(units × LIVE NAV) — the same live-NAV engine the fund
dashboard and villa SIP modal use (``dashboard.get_nav_windows``). Nothing here is
typed by hand; every number is computed from the database + live NAVs.

Phone formats differ across the two systems (client login stores E.164 "+9198…";
admin/report imports store bare 10-digit "98…"), so the match is on the LAST 10
DIGITS, which is format-independent.
"""

from __future__ import annotations

import re
import time
from typing import Optional


# ── live-NAV cache (mirrors villa_sip._ret_cache) ────────────────────────────
# One mfapi round-trip per scheme, cached a few hours, so a portfolio with many
# funds is fast and we never hammer mfapi. { scheme_code: (fetched_at, nav|None) }
_NAV_TTL_SECONDS = 6 * 3600
_nav_cache: dict[int, tuple[float, Optional[float]]] = {}


def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def _last10(phone: Optional[str]) -> str:
    """The last 10 digits of a phone number — a format-independent match key.

    '+919840571627' and '9840571627' and '0098409...' all reduce to the same
    10 digits, so E.164 (client login) and bare-10-digit (admin import) join.
    """
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _live_nav(scheme_code: Optional[int]) -> Optional[float]:
    """Latest live NAV for a scheme (cached). None on unknown code / mfapi down."""
    if not scheme_code:
        return None
    now = time.time()
    hit = _nav_cache.get(scheme_code)
    if hit and now - hit[0] < _NAV_TTL_SECONDS:
        return hit[1]
    nav: Optional[float] = None
    try:
        from app import dashboard
        windows = dashboard.get_nav_windows(scheme_code)
        if windows and windows.current_nav:
            nav = float(windows.current_nav)
    except Exception:
        nav = None
    _nav_cache[scheme_code] = (now, nav)
    return nav


def client_code_for_owner(owner: str) -> Optional[str]:
    """Resolve a logged-in user (owner) to their CRM ``client_code`` via phone.

    Returns None when the user has no phone, or no client_master row shares their
    phone's last 10 digits (i.e. the admin hasn't provisioned this client yet).
    """
    try:
        urows = _sb().table("users").select("phone").eq("owner", owner).limit(1).execute().data or []
        if not urows:
            return None
        key = _last10(urows[0].get("phone"))
        if len(key) < 10:
            return None
        # Small CRM table → a full scan matched on last-10 is fine. If it grows,
        # add a generated `phone_last10` column + index.
        masters = _sb().table("client_master").select("client_code,phone").execute().data or []
    except Exception:
        return None
    for m in masters:
        if _last10(m.get("phone")) == key:
            return m.get("client_code")
    return None


def _holdings(client_code: str) -> list[dict]:
    try:
        return _sb().table("client_holdings").select("*").eq(
            "client_code", client_code).execute().data or []
    except Exception:
        return []


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _valued_holdings(client_code: str) -> list[dict]:
    """Each holding with its live current value.

    worth = units × live NAV; if the NAV can't be fetched (unknown scheme / mfapi
    down) we fall back to ``invested`` so an unresolved fund never zeroes the
    client's money.
    """
    out = []
    for h in _holdings(client_code):
        units = _num(h.get("units"))
        invested = _num(h.get("invested"))
        nav = _live_nav(h.get("scheme_code"))
        worth = round(units * nav, 2) if (nav and units) else round(invested, 2)
        out.append({
            "scheme_name": h.get("scheme_name"),
            "scheme_code": h.get("scheme_code"),
            "units": units,
            "invested": round(invested, 2),
            "nav": nav,
            "current_value": worth,
        })
    return out


def portfolio_summary(owner: str) -> dict:
    """Real net-worth summary for the logged-in user (empty when unmatched)."""
    code = client_code_for_owner(owner)
    if not code:
        return {"worth": 0, "invested": 0, "gain": 0, "gain_pct": 0,
                "holdings_count": 0, "has_holdings": False, "client_code": None}
    hs = _valued_holdings(code)
    worth = round(sum(h["current_value"] for h in hs), 2)
    invested = round(sum(h["invested"] for h in hs), 2)
    gain = round(worth - invested, 2)
    return {
        "worth": worth,
        "invested": invested,
        "gain": gain,
        "gain_pct": round(gain / invested * 100, 2) if invested else 0,
        "holdings_count": len(hs),
        "has_holdings": bool(hs),
        "client_code": code,
    }


def portfolio_tiles(owner: str) -> list[dict]:
    """The client's estate map tiles, built from REAL holdings.

    Holdings are grouped into the admin's villa buckets by ``scheme_code`` (one
    tile per villa the client actually holds), plus a single "Other Funds" tile
    for holdings that aren't part of any bucket — so no money is hidden and the
    isometric map stays meaningful (each tile is a named villa with real worth).

    Returns [] when the client has no matched holdings. The tile shape matches
    what the frontend already renders (see estate.py `_public`).
    """
    code = client_code_for_owner(owner)
    if not code:
        return []
    hs = _valued_holdings(code)
    if not hs:
        return []

    # scheme_code → (bucket_id, bucket_name) from the admin's villa definitions
    try:
        buckets = _sb().table("villa_buckets").select("id,name,sort_order").order("sort_order").execute().data or []
        bfunds = _sb().table("villa_bucket_funds").select("bucket_id,scheme_code").execute().data or []
    except Exception:
        buckets, bfunds = [], []
    bucket_name = {b["id"]: b.get("name") or "Villa" for b in buckets}
    bucket_order = {b["id"]: b.get("sort_order", 0) for b in buckets}
    code_to_bucket: dict[int, str] = {}
    for f in bfunds:
        if f.get("scheme_code"):
            code_to_bucket.setdefault(f["scheme_code"], f["bucket_id"])

    # group holdings by bucket ("__other__" for unmatched)
    groups: dict[str, list[dict]] = {}
    for h in hs:
        bid = code_to_bucket.get(h.get("scheme_code"), "__other__")
        groups.setdefault(bid, []).append(h)

    tiles = []
    # real buckets first (in the admin's sort order), then "Other Funds"
    ordered = sorted(
        [b for b in groups if b != "__other__"],
        key=lambda b: bucket_order.get(b, 0),
    )
    if "__other__" in groups:
        ordered.append("__other__")

    for i, bid in enumerate(ordered):
        items = groups[bid]
        value = round(sum(h["current_value"] for h in items), 2)
        invested = round(sum(h["invested"] for h in items), 2)
        label = "Other Funds" if bid == "__other__" else bucket_name.get(bid, "Villa")
        tiles.append({
            "id": "other" if bid == "__other__" else f"bucket_{bid}",
            "type": "villa",
            "variant": "balanced",
            "cost": invested,
            "sipMonthly": 0,
            "sipAccrued": invested,
            "rentMonthly": 0,            # these are MF holdings — no rent
            "currentValue": value,
            "label": label,
            "boughtAt": i,
        })
    return tiles
