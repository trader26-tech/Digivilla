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


# ── villa model ──────────────────────────────────────────────────────────────
# One villa = a fixed ₹5,00,000 pillar (no tiers). Every full ₹5L INVESTED into a
# villa-forming bucket completes one villa (coin + SWP); the leftover is a single
# "under construction" pillar. Kept as a constant so it's trivial to change later.
VILLA_UNIT = 500_000.0

# Which bucket(s) form villas. For now the SIP bucket(s) — SIP is the
# accumulation plan that builds a villa up to ₹5L. Lumpsum buckets are shown in
# the picker/modal but don't drive the estate map. Easy to widen later.
def _is_villa_bucket(bucket: dict) -> bool:
    return (bucket.get("kind") or "sip") == "sip"


def _villa_tile(order: int, invested: float, value: float, *, building: bool) -> dict:
    """One villa pillar tile in the frontend's shape. `building` → still under
    construction (below ₹5L); otherwise a completed villa (coin + SWP)."""
    return {
        "id": f"villa_{order}",
        "type": "building" if building else "villa",
        "variant": "balanced",
        "cost": VILLA_UNIT,                 # a full pillar is worth ₹5L
        "sipMonthly": 0,
        "sipAccrued": round(invested, 2),   # how much of this pillar is funded
        "rentMonthly": 0,
        "currentValue": round(value, 2),
        "label": "Digivilla" if not building else "Digivilla · building",
        "boughtAt": order,
    }


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


def _first_name(full: Optional[str]) -> str:
    """First word of a name, title-cased. 'RAMPRASAD RANJEEV' → 'Ramprasad'."""
    w = (full or "").strip().split()
    return w[0].capitalize() if w else ""


def estate_name_for_owner(owner: str) -> str:
    """The name shown on the client's estate ("<name>'s City").

    Priority:
      1. The user's own custom estate name (users.estate_name) — set in Settings.
      2. The first word of their real admin record (client_master.name),
         e.g. 'RAMPRASAD RANJEEV' → 'Ramprasad'.
      3. Nothing → "" (the UI shows a neutral 'Your City').
    """
    try:
        urows = _sb().table("users").select("estate_name").eq(
            "owner", owner).limit(1).execute().data or []
        custom = (urows[0].get("estate_name") if urows else "") or ""
    except Exception:
        custom = ""
    if custom.strip():
        return custom.strip()

    code = client_code_for_owner(owner)
    if code:
        try:
            cm = _sb().table("client_master").select("name").eq(
                "client_code", code).limit(1).execute().data or []
            return _first_name(cm[0].get("name")) if cm else ""
        except Exception:
            return ""
    return ""


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
    from app import estate as estate_svc
    swp = estate_svc.total_swp(owner)   # total SWP/income paid out so far
    name = estate_name_for_owner(owner)
    city = _estate_city_for_owner(owner)
    code = client_code_for_owner(owner)
    if not code:
        return {"worth": 0, "invested": 0, "gain": 0, "gain_pct": 0,
                "total_swp": swp, "estate_name": name, "estate_city": city,
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
        "total_swp": swp,
        "estate_name": name,
        "estate_city": city,
        "holdings_count": len(hs),
        "has_holdings": bool(hs),
        "client_code": code,
    }


def _estate_city_for_owner(owner: str) -> str:
    """The user's custom city/nickname (users.estate_city), or "" if unset."""
    try:
        u = _sb().table("users").select("estate_city").eq("owner", owner).limit(1).execute().data or []
        return (u[0].get("estate_city") if u else "") or ""
    except Exception:
        return ""


def set_estate_profile(owner: str, name: Optional[str], city: Optional[str]) -> dict:
    """Save the user's custom estate name / city (Settings). Empty string clears
    a field back to the default. Returns the resolved name/city after saving."""
    patch: dict = {}
    if name is not None:
        patch["estate_name"] = name.strip()
    if city is not None:
        patch["estate_city"] = city.strip()
    if patch:
        try:
            _sb().table("users").update(patch).eq("owner", owner).execute()
        except Exception:
            pass
    return {"estate_name": estate_name_for_owner(owner),
            "estate_city": _estate_city_for_owner(owner)}


def _manual_villa_tiles(client_code: str) -> Optional[list[dict]]:
    """Tiles from the admin's MANUAL transaction→villa mapping, or None when the
    admin hasn't created any villa for this client (→ fall back to auto ₹5L).

    Each villa the admin made becomes one tile: `type = villa` when status is
    'constructed' (coin drives the gold coin), else 'building'. Value/invested =
    Σ of that villa's mapped transactions (units × live NAV). Transactions the
    admin left unmapped roll up into a single "Other Funds" net-worth tile.
    """
    try:
        villas = _sb().table("client_villas").select("*").eq(
            "client_code", client_code).order("sort_order").execute().data or []
        if not villas:
            return None
        txns = _sb().table("client_transactions").select(
            "order_id,scheme_code,units,amount,villa_id").eq(
            "client_code", client_code).execute().data or []
    except Exception:
        return None

    # value each transaction at live NAV (units × NAV); fall back to amount.
    by_villa: dict[str, dict] = {}
    other_inv = other_val = 0.0
    for t in txns:
        units = _num(t.get("units"))
        amount = _num(t.get("amount"))
        nav = _live_nav(t.get("scheme_code"))
        val = round(units * nav, 2) if (nav and units) else amount
        vid = t.get("villa_id")
        if vid:
            g = by_villa.setdefault(vid, {"inv": 0.0, "val": 0.0})
            g["inv"] += amount
            g["val"] += val
        else:
            other_inv += amount
            other_val += val

    tiles: list[dict] = []
    order = 0
    for v in villas:
        g = by_villa.get(v["id"], {"inv": 0.0, "val": 0.0})
        constructed = v.get("status") == "constructed"
        coin = bool(v.get("coin"))
        tiles.append({
            "id": f"cvilla_{v['id']}",
            "type": "villa" if constructed else "building",
            "variant": "balanced",
            "cost": VILLA_UNIT,
            "sipMonthly": 0,
            "sipAccrued": round(g["inv"], 2),
            # coin flag: the map shows a gold coin on villas with rentMonthly>0,
            # so a nominal positive value turns the coin on when the admin enabled it.
            "rentMonthly": 1 if (constructed and coin) else 0,
            "currentValue": round(g["val"], 2),
            "label": v.get("name") or "Villa",
            "boughtAt": order,
        })
        order += 1

    # Digivilla has no "land" concept: unmapped holdings are NOT shown on the
    # map (they still count in net worth via /me/portfolio). Only villas show.
    return tiles


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

    # ── MANUAL OVERRIDE: if the admin has hand-mapped this client's transactions
    #    into villas, those win over the automatic ₹5L logic below. ────────────
    manual = _manual_villa_tiles(code)
    if manual is not None:
        return manual

    # scheme_code → bucket_id for ONLY the villa-forming bucket(s). For now that
    # is the "Moderate Digivilla" bucket (matched by name, spelling-tolerant), so
    # only its funds build villas; everything else is net-worth "Other Funds".
    codes_in_villa: set[int] = set()
    try:
        buckets = _sb().table("villa_buckets").select("id,name,kind").execute().data or []
        villa_bucket_ids = {
            b["id"] for b in buckets
            if _is_villa_bucket(b)
        }
        if villa_bucket_ids:
            bfunds = _sb().table("villa_bucket_funds").select("bucket_id,scheme_code").execute().data or []
            for f in bfunds:
                if f.get("scheme_code") and f.get("bucket_id") in villa_bucket_ids:
                    codes_in_villa.add(f["scheme_code"])
    except Exception:
        codes_in_villa = set()

    # split holdings: those in a villa bucket vs. everything else
    villa_invested = 0.0
    villa_value = 0.0
    other_invested = 0.0
    other_value = 0.0
    for h in hs:
        if h.get("scheme_code") in codes_in_villa:
            villa_invested += h["invested"]
            villa_value += h["current_value"]
        else:
            other_invested += h["invested"]
            other_value += h["current_value"]

    tiles: list[dict] = []
    order = 0

    # ── villas: one completed ₹5L pillar per full VILLA_UNIT of INVESTED money;
    #    the remainder (if any) is a single "under construction" pillar. ──────
    if villa_invested > 0:
        n_complete = int(villa_invested // VILLA_UNIT)
        remainder = round(villa_invested - n_complete * VILLA_UNIT, 2)
        # live value scales with the invested split so a completed villa shows a
        # realistic current value (Σ value × its share of invested).
        val_ratio = (villa_value / villa_invested) if villa_invested else 1.0
        for _ in range(n_complete):
            tiles.append(_villa_tile(order, VILLA_UNIT, round(VILLA_UNIT * val_ratio, 2), building=False))
            order += 1
        if remainder > 0:
            tiles.append(_villa_tile(order, remainder, round(remainder * val_ratio, 2), building=True))
            order += 1

    # Digivilla has no "land" concept: unmapped/other holdings are NOT shown on
    # the map (they still count in net worth via /me/portfolio). Only villas show.
    return tiles
