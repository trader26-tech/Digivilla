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


# ── small in-process TTL memo ────────────────────────────────────────────────
# The home screen's numbers come from ~8 Supabase reads; several of them (the
# user's row, their CRM client_code, the villa bucket's scheme codes) change
# rarely but cost a network round-trip each. Memoising them per worker for a
# short TTL — and running the rest concurrently in portfolio_summary — takes
# /me/portfolio from ~2–4 s to well under a second.
_MEMO: dict[str, tuple[float, object]] = {}


def _memo(key: str, ttl: float, fn):
    now = time.time()
    hit = _MEMO.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    val = fn()
    _MEMO[key] = (now, val)
    return val


def _memo_clear(prefix: str) -> None:
    for k in [k for k in _MEMO if k.startswith(prefix)]:
        _MEMO.pop(k, None)


def _user_row(owner: str) -> dict:
    """One read of the user's row (phone, estate_name, estate_city) instead of
    three separate ones. Short TTL; cleared when the profile is saved."""
    def load():
        try:
            rows = _sb().table("users").select("phone,estate_name,estate_city").eq(
                "owner", owner).limit(1).execute().data or []
            return rows[0] if rows else {}
        except Exception:
            return {}
    return _memo(f"user:{owner}", 30, load)


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
    """Latest PUBLISHED NAV for a scheme, from the shared daily DB cache
    (``nav_cache``). Reads scheme_nav_cache; refreshes on read if today's NAV
    isn't stamped yet. Always the latest AMFI value, shared across workers and
    surviving restarts — no per-user sockets (NAVs update once a day)."""
    from app import nav_cache
    return nav_cache.get_nav(scheme_code)


def client_code_for_owner(owner: str) -> Optional[str]:
    """Resolve a logged-in user (owner) to their CRM ``client_code`` via phone.

    Returns None when the user has no phone, or no client_master row shares their
    phone's last 10 digits (i.e. the admin hasn't provisioned this client yet).
    """
    def resolve():
        key = _last10(_user_row(owner).get("phone"))
        if len(key) < 10:
            return None
        # Small CRM table → a full scan matched on last-10 is fine. If it grows,
        # add a generated `phone_last10` column + index.
        try:
            masters = _memo("client_master", 300, lambda: _sb().table("client_master")
                            .select("client_code,phone").execute().data or [])
        except Exception:
            return None
        for m in masters:
            if _last10(m.get("phone")) == key:
                return m.get("client_code")
        return None
    return _memo(f"code:{owner}", 600, resolve)


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
    custom = (_user_row(owner).get("estate_name") or "").strip()
    if custom:
        return custom

    code = client_code_for_owner(owner)
    if code:
        def load():
            try:
                cm = _sb().table("client_master").select("name").eq(
                    "client_code", code).limit(1).execute().data or []
                return _first_name(cm[0].get("name")) if cm else ""
            except Exception:
                return ""
        return _memo(f"cmname:{code}", 600, load)
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
    from app import nav_cache
    hs = _holdings(client_code)
    # Warm every scheme's latest NAV in parallel first, so the per-holding
    # _live_nav() calls below are all in-memory (cold worker: ~1 round-trip).
    nav_cache.prewarm([h.get("scheme_code") for h in hs])
    out = []
    for h in hs:
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


def live_navs(owner: str) -> dict:
    """Every fund the user holds with its LIVE published NAV and that NAV's own
    date — what the "portfolio value" figure is actually built from. Powers the
    tap-the-value sheet, so the user can check any number against their
    statement or any other platform.
    """
    from app import nav_cache
    code = client_code_for_owner(owner)
    if not code:
        return {"funds": [], **nav_cache.freshness([])}
    hs = _holdings(code)
    nav_cache.prewarm([h.get("scheme_code") for h in hs])
    funds = []
    for h in hs:
        sc = h.get("scheme_code")
        meta = nav_cache.get_nav_meta(sc) or {}
        units = _num(h.get("units"))
        nav = meta.get("nav")
        invested = round(_num(h.get("invested")), 2)
        value = round(units * nav, 2) if (nav and units) else invested
        funds.append({
            "name": h.get("scheme_name") or "Fund",
            "scheme_code": sc,
            "units": round(units, 3),
            "nav": nav,
            "nav_date": meta.get("nav_date"),
            "value": value,
            "invested": invested,
            "gain": round(value - invested, 2),
        })
    funds.sort(key=lambda f: f["value"], reverse=True)
    return {"funds": funds, **nav_cache.freshness([h.get("scheme_code") for h in hs])}


def live_houses(owner: str) -> dict:
    """The portfolio value broken down BY HOUSE — what the tap-the-value sheet
    shows. Each completed ₹5L villa (and the one under construction) carries its
    own live value, gain, and the funds behind it, so a user can open one house
    and see exactly which units make it up.

    A house's slice is the same apportioning ``portfolio_tiles`` uses: each
    scheme is divided across the stacked ₹5L pillars in proportion to invested.
    """
    from app import nav_cache
    code = client_code_for_owner(owner)
    if not code:
        return {"houses": [], **nav_cache.freshness([])}

    hs = _valued_holdings(code)
    codes_in_villa = _villa_scheme_codes()
    villa_hs = [h for h in hs if h.get("scheme_code") in codes_in_villa] or hs
    total_inv = sum(h["invested"] for h in villa_hs)
    if total_inv <= 0:
        return {"houses": [], **nav_cache.freshness([h.get("scheme_code") for h in hs])}

    # The board is a fixed 3x3, so the estate tops out at 9 villas. Beyond that
    # there is no plot left to build on: everything above 9 x VILLA_UNIT rolls
    # into the ninth house rather than inventing a tenth with no board position.
    HOUSES_MAX = 9
    n_complete = min(HOUSES_MAX, int(total_inv // VILLA_UNIT))
    remainder = round(total_inv - n_complete * VILLA_UNIT, 2)
    spans = [(i * VILLA_UNIT, (i + 1) * VILLA_UNIT, False) for i in range(n_complete)]
    if n_complete >= HOUSES_MAX:
        # full estate: fold any surplus into the last house
        if remainder > 1 and spans:
            lo, _, _ = spans[-1]
            spans[-1] = (lo, total_inv, False)
    elif remainder > 1:
        spans.append((n_complete * VILLA_UNIT, total_inv, True))

    houses = []
    for idx, (lo, hi, building) in enumerate(spans):
        share = max(0.0, hi - lo) / total_inv
        funds, value, invested = [], 0.0, 0.0
        for h in villa_hs:
            meta = nav_cache.get_nav_meta(h.get("scheme_code")) or {}
            f_units = h["units"] * share
            f_inv = h["invested"] * share
            nav = meta.get("nav")
            f_val = f_units * nav if (nav and f_units) else f_inv
            value += f_val
            invested += f_inv
            funds.append({
                "name": h.get("scheme_name") or "Fund",
                "scheme_code": h.get("scheme_code"),
                "units": round(f_units, 3),
                "nav": nav,
                "nav_date": meta.get("nav_date"),
                "value": round(f_val, 2),
                "invested": round(f_inv, 2),
                "gain": round(f_val - f_inv, 2),
            })
        funds.sort(key=lambda f: f["value"], reverse=True)
        houses.append({
            "id": f"villa_{idx}",
            "index": idx,
            "building": building,
            "invested": round(invested, 2),
            "value": round(value, 2),
            "gain": round(value - invested, 2),
            # how far the in-progress pillar has come (0-100)
            "pct": (round(min(99.0, (hi - lo) / VILLA_UNIT * 100), 1)
                     if building else 100.0),
            "funds": funds,
        })
    return {"houses": houses, **nav_cache.freshness([h.get("scheme_code") for h in hs])}


def portfolio_summary(owner: str) -> dict:
    """Real net-worth summary for the logged-in user (empty when unmatched)."""
    from app import estate as estate_svc
    from app import nav_cache
    from concurrent.futures import ThreadPoolExecutor
    # These four don't depend on each other — fetch them at the same time.
    with ThreadPoolExecutor(max_workers=4) as ex:
        f_swp = ex.submit(lambda: _memo(f"swp:{owner}", 60, lambda: estate_svc.total_swp(owner)))
        f_name = ex.submit(estate_name_for_owner, owner)
        f_city = ex.submit(_estate_city_for_owner, owner)
        f_code = ex.submit(client_code_for_owner, owner)
        swp, name, city, code = f_swp.result(), f_name.result(), f_city.result(), f_code.result()
    if not code:
        return {"worth": 0, "invested": 0, "gain": 0, "gain_pct": 0,
                "total_swp": swp, "estate_name": name, "estate_city": city,
                "holdings_count": 0, "has_holdings": False, "client_code": None,
                **nav_cache.freshness([])}
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
        # freshness: when the NAVs behind this number were published / pulled,
        # when this response was computed, and when the next daily refresh lands
        **nav_cache.freshness([h.get("scheme_code") for h in hs]),
    }


def _estate_city_for_owner(owner: str) -> str:
    """The user's custom city/nickname (users.estate_city), or "" if unset."""
    return (_user_row(owner).get("estate_city") or "")


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
    _memo_clear(f"user:{owner}")   # the row just changed — drop the cached copy
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


# ============================================================================
# BUILDING / VILLA RETURNS DETAIL (tapped tile → full breakdown + growth chart)
# ============================================================================
def _building_scheme_holdings(client_code: str, tile_id: str) -> Optional[list[dict]]:
    """The per-scheme holdings that make up ONE building/villa tile.

    Returns [{scheme_code, scheme_name, units, invested}] or None if unknown.
    - cvilla_<villa_id>  → that villa's mapped client_transactions, aggregated per scheme.
    - villa_N            → the auto ₹5L-split path: this villa's slice of the villa-bucket
                           holdings (proportional to its ₹5L share of total villa invested).
    """
    if tile_id.startswith("cvilla_"):
        villa_id = tile_id[len("cvilla_"):]
        try:
            txns = _sb().table("client_transactions").select(
                "scheme_code,scheme_name,units,amount").eq(
                "client_code", client_code).eq("villa_id", villa_id).execute().data or []
        except Exception:
            return None
        agg: dict[int, dict] = {}
        for t in txns:
            code = t.get("scheme_code")
            if not code:
                continue
            e = agg.setdefault(code, {"scheme_code": code,
                                      "scheme_name": t.get("scheme_name"),
                                      "units": 0.0, "invested": 0.0})
            e["units"] += _num(t.get("units"))
            e["invested"] += _num(t.get("amount"))
        return list(agg.values()) if agg else []

    if tile_id.startswith("villa_"):
        # auto path: villa N holds a ₹5L slice of the villa-forming holdings. We
        # apportion each scheme's units/invested by this villa's share of the total.
        try:
            idx = int(tile_id[len("villa_"):])
        except ValueError:
            return None
        hs = _valued_holdings(client_code)
        codes_in_villa = _villa_scheme_codes()
        villa_hs = [h for h in hs if h.get("scheme_code") in codes_in_villa]
        total_inv = sum(h["invested"] for h in villa_hs)
        if total_inv <= 0:
            return []
        # this villa's rupee span within the stacked ₹5L pillars
        lo = idx * VILLA_UNIT
        hi = min((idx + 1) * VILLA_UNIT, total_inv)
        share = max(0.0, (hi - lo)) / total_inv if total_inv else 0.0
        if share <= 0:
            return []
        return [{
            "scheme_code": h["scheme_code"], "scheme_name": h.get("scheme_name"),
            "units": h["units"] * share, "invested": round(h["invested"] * share, 2),
        } for h in villa_hs]

    return None


def _villa_scheme_codes() -> set:
    """scheme_codes belonging to SIP (villa-forming) buckets — mirrors portfolio_tiles."""
    return _memo("villa_codes", 300, _villa_scheme_codes_load)


def _villa_scheme_codes_load() -> set:
    codes: set = set()
    try:
        buckets = _sb().table("villa_buckets").select("id,name,kind").execute().data or []
        vids = {b["id"] for b in buckets if _is_villa_bucket(b)}
        if vids:
            bf = _sb().table("villa_bucket_funds").select("bucket_id,scheme_code").execute().data or []
            for f in bf:
                if f.get("scheme_code") and f.get("bucket_id") in vids:
                    codes.add(f["scheme_code"])
    except Exception:
        pass
    return codes


def _tile_meta(client_code: str, tile_id: str) -> dict:
    """name + status (building|constructed) for a tile id."""
    if tile_id.startswith("cvilla_"):
        vid = tile_id[len("cvilla_"):]
        try:
            rows = _sb().table("client_villas").select("name,status").eq("id", vid).limit(1).execute().data or []
            if rows:
                return {"name": rows[0].get("name") or "Villa",
                        "status": rows[0].get("status") or "building"}
        except Exception:
            pass
    return {"name": "Villa", "status": "building"}


# Fund categories are static config — load the whole villa_bucket_funds map ONCE
# per worker (a short TTL) instead of a DB round-trip per scheme (the report loop
# used to hit this twice per fund).
_CAT_TTL = 600
_cat_memo: dict = {}


def _all_fund_categories() -> dict:
    import time as _t
    now = _t.time()
    hit = _cat_memo.get("m")
    if hit and now - hit[0] < _CAT_TTL:
        return hit[1]
    m: dict = {}
    try:
        rows = _sb().table("villa_bucket_funds").select("scheme_code,category").execute().data or []
        for r in rows:
            c = r.get("scheme_code")
            if c and c not in m and r.get("category"):
                m[c] = r["category"]
    except Exception:
        pass
    _cat_memo["m"] = (now, m)
    return m


def _fund_category(scheme_code: int) -> Optional[str]:
    """Category from the villa_bucket_funds definition, if present (memoized)."""
    return _all_fund_categories().get(scheme_code)


def _blended_growth(funds: list[dict], navfull: Optional[dict] = None) -> list[dict]:
    """A blended 'growth of your money' series for the building, weighted by each
    fund's invested amount, using real NAV history. Returns [{date, value, rent}]
    where value = today's-money grown back over time, rent = cumulative SWP (0 for
    now). Robust: funds with no history are skipped from the blend.

    Pass the `navfull` map from _nav_full_map() to reuse an already-fetched
    history (the report page fetches each fund exactly once); else it fetches."""
    from datetime import date, timedelta
    total_inv = sum(f["invested"] for f in funds) or 1.0
    if navfull is None:
        navfull = _nav_full_map(funds)
    # each fund's trailing-5y NAV points (all of them if shorter) → growth factor
    series = []
    for f in funds:
        pts = [p for p in (navfull.get(f["scheme_code"]) or []) if p.nav]
        if len(pts) < 2:
            continue
        cutoff = (date.fromisoformat(pts[-1].date) - timedelta(days=365 * 5)).isoformat()
        win = [p for p in pts if p.date >= cutoff]
        if len(win) < 2:
            win = pts
        base = win[0].nav
        w = f["invested"] / total_inv
        series.append((w, base, {p.date: p.nav for p in win}, [p.date for p in win]))
    if not series:
        return []
    # union of dates (sorted); blended value at each date = Σ w * invested_total * (nav/base)
    all_dates = sorted({d for _, _, m, _ in series for d in m})
    # downsample to ~120 points for a light payload
    if len(all_dates) > 120:
        step = len(all_dates) // 120
        all_dates = all_dates[::step]
    out = []
    for d in all_dates:
        factor = 0.0
        for w, base, m, ds in series:
            # nearest prior nav on/of this date
            nav = m.get(d)
            if nav is None:
                # carry last known ≤ d
                prior = [x for x in ds if x <= d]
                nav = m[prior[-1]] if prior else base
            factor += w * (nav / base)
        out.append({"date": d, "value": round(total_inv * factor, 2), "rent": 0.0})
    return out


# In-process NAV-history memo (per worker). NAV history only grows by one point
# a day, so a 6h TTL is safe and makes repeat taps on the report instant.
_HIST_TTL = 6 * 3600
_hist_memo: dict = {}


def _fetch_full_nav_memo(code: int) -> list:
    """Full daily NAV history for one scheme, memoized per worker."""
    import time as _t
    from app import dashboard
    now = _t.time()
    hit = _hist_memo.get(code)
    if hit and now - hit[0] < _HIST_TTL:
        return hit[1]
    try:
        pts = dashboard._fetch_full_nav(code) or []
    except Exception:
        pts = []
    # Only cache a non-empty result, so a transient mfapi failure retries next time.
    if pts:
        _hist_memo[code] = (now, pts)
    return pts


def _nav_full_map(holdings: list[dict]) -> dict:
    """{scheme_code: [NavPoint…] ascending} for every scheme in `holdings`,
    fetched CONCURRENTLY (one thread per fund) and memoized. Shared by the growth
    series and the drained-value backtest so the report page fetches each fund at
    most once, and all funds in roughly one round-trip instead of N sequential."""
    from concurrent.futures import ThreadPoolExecutor
    codes = []
    for h in holdings:
        c = h.get("scheme_code")
        if c and c not in codes:
            codes.append(c)
    if not codes:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(codes))) as ex:
        results = list(ex.map(_fetch_full_nav_memo, codes))
    return dict(zip(codes, results))


def _month_map(points: list) -> dict:
    """Month-end NAVs {'YYYY-MM': nav} from an ascending daily series."""
    m: dict = {}
    for p in points:
        if p.nav:
            m[p.date[:7]] = p.nav          # ascending → last write is the month end
    return m


# Monthly payout per finished villa (₹) — the gold withdrawal on the home header.
VILLA_INCOME = 1500.0


def _drained_ranges(holdings: list[dict], navfull: dict, invested: float,
                    monthly: float) -> dict:
    """What `invested` in THIS villa's real mix became over the trailing
    12 / 36 / 60 months while `monthly` ₹ was withdrawn every month — the chart
    the report page draws. Real month-end NAVs, real weights (each fund's share
    of invested). The withdrawal is sold from the ARBITRAGE sleeve while it lasts
    (the app's payout model), then pro-rata across the rest so the payout never
    silently stops. A range is omitted when the funds don't share enough history.

    Returns {"1y"|"3y"|"5y": [{month:'YYYY-MM', value:int, withdrawn:int}, …]}.
    """
    if invested <= 0 or not holdings:
        return {}
    total_inv = sum(_num(h.get("invested")) for h in holdings) or 1.0
    funds = []
    for h in holdings:
        code = h.get("scheme_code")
        mm = _month_map(navfull.get(code) or [])
        if len(mm) < 3:
            continue
        w = _num(h.get("invested")) / total_inv
        funds.append({"code": code, "w": w, "nav": mm,
                      "arb": _sleeve_tag("", h.get("scheme_name") or "") == "ARB"})
    if not funds:
        return {}
    common = None
    for f in funds:
        keys = set(f["nav"].keys())
        common = keys if common is None else (common & keys)
    months_all = sorted(common or [])
    out: dict = {}
    for key, n in (("1y", 12), ("3y", 36), ("5y", 60)):
        months = months_all[-(n + 1):]
        if len(months) < 3:
            continue
        units = {f["code"]: (invested * f["w"]) / f["nav"][months[0]] for f in funds}
        arb = [f for f in funds if f["arb"]]
        pts = []
        withdrawn = 0.0
        for i, mk in enumerate(months):
            if i and monthly > 0:
                need = monthly
                # 1) sell from the arbitrage sleeve first
                for f in arb:
                    if need <= 0:
                        break
                    px = f["nav"][mk]
                    sold = min(need / px, units[f["code"]])
                    units[f["code"]] -= sold
                    need -= sold * px
                # 2) whatever is left, pro-rata across every fund still holding units
                if need > 0:
                    live = [f for f in funds if units[f["code"]] > 0]
                    tot = sum(units[f["code"]] * f["nav"][mk] for f in live)
                    if tot > 0:
                        for f in live:
                            px = f["nav"][mk]
                            take = min(need * (units[f["code"]] * px / tot) / px, units[f["code"]])
                            units[f["code"]] -= take
                            need -= take * px
                withdrawn += monthly - max(0.0, need)
            value = sum(units[f["code"]] * f["nav"][mk] for f in funds)
            pts.append({"month": mk, "value": round(value), "withdrawn": round(withdrawn)})
        out[key] = pts
    return out


def _returns_from_points(points: list) -> dict:
    """Annualized 1Y/3Y/5Y return (% p.a.) from an ALREADY-FETCHED ascending NAV
    series — same math as villa_sip._live_returns / dashboard windows, but with no
    extra network call (we reuse the history the report already pulled)."""
    from datetime import date, timedelta
    out = {"ret_1y": None, "ret_3y": None, "ret_5y": None}
    pts = [p for p in (points or []) if getattr(p, "nav", None)]
    if len(pts) < 2:
        return out
    latest = pts[-1]
    try:
        latest_d = date.fromisoformat(latest.date)
    except (ValueError, AttributeError):
        return out
    for key, years in (("ret_1y", 1), ("ret_3y", 3), ("ret_5y", 5)):
        cutoff = (latest_d - timedelta(days=365 * years)).isoformat()
        prior = [p for p in pts if p.date <= cutoff]
        start = prior[-1] if prior else (pts[0] if pts[0].date < latest.date else None)
        if not start or not start.nav:
            continue
        growth = latest.nav / start.nav
        if years == 1:
            out[key] = round((growth - 1) * 100, 2)
        else:
            out[key] = round((growth ** (1.0 / years) - 1) * 100, 2)  # CAGR
    return out


def _since_date(client_code: str, tile_id: str) -> str:
    """The real 'you invested on' date — the earliest order behind this tile
    (that villa's mapped orders for cvilla_…, else the client's first order)."""
    try:
        q = _sb().table("client_transactions").select("txn_date").eq("client_code", client_code)
        if tile_id.startswith("cvilla_"):
            q = q.eq("villa_id", tile_id[len("cvilla_"):])
        rows = q.execute().data or []
    except Exception:
        return ""
    ds = sorted(r["txn_date"] for r in rows if r.get("txn_date"))
    return ds[0] if ds else ""


def _next_credit_date() -> str:
    """The 1st of next month (payouts land 'on the 1st'), ISO."""
    from datetime import date
    today = date.today()
    y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return date(y, m, 1).isoformat()


def building_detail(owner: str, tile_id: str, chart: bool = True) -> Optional[dict]:
    """Full returns breakdown for one building/villa tile: headline gain, build
    progress, per-fund allocation + live 1/3/5-Yr returns, a blended growth
    series, and the drained-value chart (what this mix did while paying out).

    `chart=False` = the FAST first paint: headline + funds from the cached latest
    NAVs only, NO mfapi history fetch (the slow part) — the growth/withdraw series
    come back empty and the client loads them via building_chart() straight after.
    """
    code = client_code_for_owner(owner)
    if not code:
        return None
    holdings = _building_scheme_holdings(code, tile_id)
    if holdings is None:
        return None

    meta = _tile_meta(code, tile_id)
    total_inv = sum(h["invested"] for h in holdings)
    # A generated villa_N pillar is 'constructed' once its ₹5L slice is full;
    # a manual cvilla_ keeps the admin's status. stage 0..4 = build stage, 5 = villa.
    constructed = (meta["status"] == "constructed") if tile_id.startswith("cvilla_") \
        else total_inv >= VILLA_UNIT - 1
    status = "constructed" if constructed else "building"
    stage = 5 if constructed else min(4, int(total_inv // 100_000))
    # Only the chart needs full NAV history; skip that fetch on the fast first paint.
    navfull = _nav_full_map(holdings) if chart else {}

    funds = []
    cur_total = 0.0
    wsum = {"1y": 0.0, "3y": 0.0, "5y": 0.0}
    wt = {"1y": 0.0, "3y": 0.0, "5y": 0.0}
    for h in holdings:
        scheme = h["scheme_code"]
        nav = _live_nav(scheme)
        cur = round(h["units"] * nav, 2) if (nav and h["units"]) else round(h["invested"], 2)
        cur_total += cur
        # Returns from the history we ALREADY fetched (no second round-trip); on the
        # fast paint there's no history yet, so returns come back None ("—").
        rets = _returns_from_points(navfull.get(scheme) or []) if chart else \
            {"ret_1y": None, "ret_3y": None, "ret_5y": None}
        alloc = round(h["invested"] / total_inv * 100, 1) if total_inv else 0.0
        funds.append({
            "scheme_name": h.get("scheme_name"),
            "scheme_code": scheme,
            "category": _fund_category(scheme) or "Other",
            "allocation": alloc,
            "invested": round(h["invested"], 2),
            "current_value": cur,
            "gain": round(cur - h["invested"], 2),
            "ret_1y": rets["ret_1y"], "ret_3y": rets["ret_3y"], "ret_5y": rets["ret_5y"],
            "tag": _sleeve_tag(_fund_category(scheme) or "", h.get("scheme_name") or ""),
        })
        for k, rk in (("1y", "ret_1y"), ("3y", "ret_3y"), ("5y", "ret_5y")):
            if rets[rk] is not None and h["invested"] > 0:
                wsum[k] += rets[rk] * h["invested"]
                wt[k] += h["invested"]
    funds.sort(key=lambda f: -f["allocation"])

    overall = {f"ret_{k}": (round(wsum[k] / wt[k], 2) if wt[k] else None) for k in ("1y", "3y", "5y")}
    gain = round(cur_total - total_inv, 2)

    monthly = VILLA_INCOME if constructed else 0.0
    arb_fund = next((f["scheme_name"] for f in funds if f["tag"] == "ARB"), None)

    return {
        "tile_id": tile_id,
        "name": meta["name"],
        "status": status,
        "stage": stage,
        "since": _since_date(code, tile_id),
        "invested": round(total_inv, 2),
        "current_value": round(cur_total, 2),
        "gain": gain,
        "gain_pct": round(gain / total_inv * 100, 2) if total_inv else 0.0,
        "overall": overall,
        "rent_paid": 0.0,   # SWP not wired yet — modeled into growth as a 0 band
        "payout": {
            "monthly": round(monthly),
            "next_credit": _next_credit_date() if constructed else "",
            "from_fund": arb_fund or "your arbitrage fund",
        },
        "withdraw": {
            "monthly": round(monthly),
            "ranges": _drained_ranges(holdings, navfull, total_inv, monthly) if chart else {},
        },
        "progress": {
            "unit": VILLA_UNIT,
            "funded": round(total_inv, 2),
            "remaining": round(max(0.0, VILLA_UNIT - total_inv), 2),
            "pct": round(min(1.0, total_inv / VILLA_UNIT) * 100, 1) if VILLA_UNIT else 0.0,
        },
        "funds": funds,
        "growth": _blended_growth(holdings, navfull) if chart else [],
        # False on the fast paint → the client knows to fetch building_chart() next.
        "has_chart": bool(chart),
    }


def building_chart(owner: str, tile_id: str) -> Optional[dict]:
    """Just the history-derived pieces of the report — the drained-value chart
    (withdraw.ranges), the blended growth series, and the per-fund + overall
    1/3/5-Yr returns. Loaded straight after the fast building_detail(chart=False)
    so the page paints instantly and the chart fills in a moment later."""
    code = client_code_for_owner(owner)
    if not code:
        return None
    holdings = _building_scheme_holdings(code, tile_id)
    if holdings is None:
        return None
    total_inv = sum(h["invested"] for h in holdings)
    constructed = total_inv >= VILLA_UNIT - 1
    if tile_id.startswith("cvilla_"):
        constructed = _tile_meta(code, tile_id)["status"] == "constructed"
    monthly = VILLA_INCOME if constructed else 0.0
    navfull = _nav_full_map(holdings)

    per_fund = {}
    wsum = {"1y": 0.0, "3y": 0.0, "5y": 0.0}
    wt = {"1y": 0.0, "3y": 0.0, "5y": 0.0}
    for h in holdings:
        rets = _returns_from_points(navfull.get(h["scheme_code"]) or [])
        per_fund[h["scheme_code"]] = rets
        for k, rk in (("1y", "ret_1y"), ("3y", "ret_3y"), ("5y", "ret_5y")):
            if rets[rk] is not None and h["invested"] > 0:
                wsum[k] += rets[rk] * h["invested"]
                wt[k] += h["invested"]
    overall = {f"ret_{k}": (round(wsum[k] / wt[k], 2) if wt[k] else None) for k in ("1y", "3y", "5y")}

    return {
        "tile_id": tile_id,
        "overall": overall,
        "fund_returns": {str(c): r for c, r in per_fund.items()},
        "withdraw": {"monthly": round(monthly),
                     "ranges": _drained_ranges(holdings, navfull, total_inv, monthly)},
        "growth": _blended_growth(holdings, navfull),
    }


def allocation_summary(owner: str) -> dict:
    """INSTANT fund-allocation for the home allocation bar — just the client's SIP
    villa mix (name/category/allocation %), two cheap DB reads. No worth/NAV or
    live-return computation (that's the slow part in /me/funds/portfolio). The
    frontend multiplies each allocation by its already-loaded portfolio value."""
    from app import villa_sip
    rows = []
    try:
        buckets = _sb().table("villa_buckets").select("id,name,kind").execute().data or []
        sip = next((b for b in buckets if (b.get("kind") or "sip") == "sip"), buckets[0] if buckets else None)
        if sip:
            # Try to read the explicit `sleeve` column; if the migration hasn't
            # been applied yet, fall back to the older column set so the bar keeps
            # working (sleeve is then inferred from category/name).
            try:
                rows = (_sb().table("villa_bucket_funds")
                        .select("scheme_name,scheme_code,category,sleeve,target_weight,sort_order")
                        .eq("bucket_id", sip["id"]).order("sort_order").execute().data or [])
            except Exception:
                rows = (_sb().table("villa_bucket_funds")
                        .select("scheme_name,scheme_code,category,target_weight,sort_order")
                        .eq("bucket_id", sip["id"]).order("sort_order").execute().data or [])
    except Exception:
        rows = []
    funds = []
    for r in rows:
        alloc = villa_sip._to_pct_weight(r.get("target_weight"))
        name = r.get("scheme_name") or "Fund"
        category = r.get("category") or ""
        # The concentration sleeve is authoritative for the home bar's label +
        # colour — from the admin's explicit setting, else inferred. Sending it
        # up means the client never has to guess by position again.
        sleeve = _fund_sleeve(r.get("sleeve") or "", category, name)
        funds.append({
            "name": name,
            "scheme_code": r.get("scheme_code"),
            "category": category,
            "sleeve": sleeve,
            "allocation": round(alloc, 1),
        })
    return {"funds": funds}


# ---------------------------------------------------------------------------
# Settings tab — real orders + personal details (from the CRM report tables)
# ---------------------------------------------------------------------------

# Sleeve → short tag used across the client app (home bar chip + reports).
_SLEEVE_TO_TAG = {
    "arbitrage": "ARB", "gold": "GOLD",
    "large": "LARGE", "mid": "MID", "small": "SMALL", "other": "",
}


def _fund_sleeve(sleeve: str, category: str, name: str) -> str:
    """The canonical concentration sleeve for a fund — the single source of the
    home allocation bar's label + colour.

    Priority:
      1. an EXPLICIT ``sleeve`` set by the admin on the fund (arbitrage / gold /
         large / mid / small / other) — authoritative;
      2. else a scan of the fund's category, then its scheme name.

    Returns one of: 'arbitrage' | 'gold' | 'large' | 'mid' | 'small' | 'other'.
    'other' is never blank so the bar always has a stable label/colour to use."""
    s = (sleeve or "").strip().lower()
    if s in _SLEEVE_TO_TAG:
        return s
    hay = f"{(category or '').lower()} {(name or '').lower()}"
    if "arbitrage" in hay:
        return "arbitrage"
    if "gold" in hay:
        return "gold"
    if "small" in hay:
        return "small"
    if "mid" in hay:
        return "mid"
    if "large" in hay or "momentum" in hay or "flexi" in hay or "index" in hay:
        return "large"
    return "other"


def _sleeve_tag(category: str, name: str, sleeve: str = "") -> str:
    """The short coloured sleeve tag for a fund (ARB/GOLD/LARGE/MID/SMALL, or ""
    for 'other'), matching the Home allocation bar. Prefers an explicit admin
    ``sleeve``, then a category/name scan."""
    return _SLEEVE_TO_TAG.get(_fund_sleeve(sleeve, category, name), "")


def orders_for_owner(owner: str) -> list[dict]:
    """Every real fund order on this user's account (from ``client_transactions``,
    the parsed AssetPlus report), newest first — for Settings → Transactions.

    Each row: date (YYYY-MM-DD), fund (scheme name), kind (Lumpsum/Purchase/…),
    amount (₹), units, nav, and a coloured `tag` (ARB/GOLD/LARGE/MID/SMALL).
    Empty list when the user has no mapped CRM client / no transactions.
    """
    code = client_code_for_owner(owner)
    if not code:
        return []
    # NOTE: client_transactions has NO `category` column — selecting it makes
    # PostgREST 400 and silently empties the list. Select only real columns and
    # derive the sleeve tag from the scheme name.
    try:
        rows = (_sb().table("client_transactions")
                .select("txn_date,scheme_name,scheme_code,kind,amount,units,nav")
                .eq("client_code", code).execute().data or [])
    except Exception:
        return []
    out = []
    for r in rows:
        name = r.get("scheme_name") or "Fund"
        kind = (r.get("kind") or "Purchase").strip() or "Purchase"
        try:
            amount = round(float(r.get("amount") or 0))
        except (TypeError, ValueError):
            amount = 0
        low = kind.lower()
        out.append({
            "date": r.get("txn_date") or "",
            "fund": name,
            "kind": kind,
            "amount": amount,
            "units": r.get("units"),
            "nav": r.get("nav"),
            "tag": _sleeve_tag("", name),
            # rent/SWP/redemption payouts flow OUT to the user
            "direction": "out" if ("payout" in low or "swp" in low or "redemption" in low or "withdraw" in low) else "in",
        })
    out.sort(key=lambda x: x["date"] or "", reverse=True)
    return out


def details_for_owner(owner: str) -> dict:
    """This user's KYC / personal details, straight from their ``client_master``
    CRM record (phone-bridged). Fields the app shows: name, phone, email, PAN,
    DOB, address, client_code, and a 'since' month. Missing fields come back "".
    """
    code = client_code_for_owner(owner)
    empty = {"name": "", "phone": "", "email": "", "pan": "", "dob": "",
             "address": "", "bank": "", "client_code": code or "", "since": ""}
    if not code:
        return empty
    try:
        rows = (_sb().table("client_master").select("*")
                .eq("client_code", code).limit(1).execute().data or [])
    except Exception:
        return empty
    if not rows:
        return empty
    m = rows[0]
    addr_parts = [m.get("address"), m.get("city"), m.get("state"), m.get("pin")]
    address = ", ".join(str(p).strip() for p in addr_parts if p and str(p).strip())
    return {
        "name": (m.get("name") or "").strip(),
        "phone": (m.get("phone") or "").strip(),
        "email": (m.get("email") or "").strip(),
        "pan": (m.get("pan") or "").strip(),
        "dob": (m.get("dob") or "").strip(),
        "address": address,
        "bank": (m.get("bank") or "").strip(),
        "client_code": code,
        "since": (m.get("signup") or "").strip(),
    }
