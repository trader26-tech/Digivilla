"""Per-user estate board — the tiles (villas / land / builds) a user owns on
their map, keyed to their `owner` id so every account has its own estate.

A brand-new user has NO tiles: an empty estate, all values zero, until they
build. Stored in the Supabase table `estate_tiles` when configured, else a local
JSON file (dev fallback) — mirroring the dual-store pattern used across the
backend.
"""

from __future__ import annotations

import json
import os

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_LOCAL = os.path.join(_DATA_DIR, "estate_tiles.json")
_TABLE = "estate_tiles"

# columns we accept from the client (whitelist), snake_case as stored
_FIELDS = ("id", "type", "variant", "cost", "sip_monthly", "sip_accrued",
           "rent_monthly", "label", "bought_at")

_TABLE_OK = None  # None = unprobed


def _use_supabase() -> bool:
    global _TABLE_OK
    if _TABLE_OK is not None:
        return _TABLE_OK
    try:
        from app.supabase_client import get_supabase

        get_supabase().table(_TABLE).select("id").limit(1).execute()
        _TABLE_OK = True
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in (_TABLE, "does not exist", "pgrst205",
                                  "schema cache", "could not find", "not configured")):
            _TABLE_OK = False
        else:
            return False
    return _TABLE_OK


def _load_local() -> list[dict]:
    try:
        with open(_LOCAL, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_local(rows: list[dict]) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = _LOCAL + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _LOCAL)


def _clean(tile: dict, owner: str) -> dict:
    """Keep only known fields; coerce numbers; stamp the owner."""
    out = {"owner": owner}
    for k in _FIELDS:
        out[k] = tile.get(k)
    out["id"] = str(out.get("id") or "")
    out["type"] = out.get("type") or "land"
    out["variant"] = out.get("variant") or "balanced"
    for n in ("cost", "sip_monthly", "sip_accrued", "rent_monthly"):
        try:
            out[n] = float(out.get(n) or 0)
        except (TypeError, ValueError):
            out[n] = 0.0
    try:
        out["bought_at"] = int(out.get("bought_at") or 0)
    except (TypeError, ValueError):
        out["bought_at"] = 0
    out["label"] = out.get("label") or ""
    return out


def _public(row: dict) -> dict:
    """Shape a stored row back into the client's tile format."""
    return {
        "id": row.get("id", ""),
        "type": row.get("type", "land"),
        "variant": row.get("variant", "balanced"),
        "cost": float(row.get("cost", 0) or 0),
        "sipMonthly": float(row.get("sip_monthly", 0) or 0),
        "sipAccrued": float(row.get("sip_accrued", 0) or 0),
        "rentMonthly": float(row.get("rent_monthly", 0) or 0),
        "label": row.get("label", ""),
        "boughtAt": int(row.get("bought_at", 0) or 0),
    }


def get_tiles(owner: str) -> list[dict]:
    """Every tile this user owns (empty list for a brand-new account).

    The source of truth is the CRM (`user_villas` — the same rows the admin
    assigns/edits), so whatever the advisor maps to a client shows up on the
    client's map instantly. We fall back to the legacy `estate_tiles` store only
    when the CRM has nothing for this user (older accounts / offline dev)."""
    crm = _tiles_from_crm(owner)
    if crm:
        return crm
    if _use_supabase():
        try:
            from app.supabase_client import get_supabase

            rows = (get_supabase().table(_TABLE).select("*")
                    .eq("owner", owner).execute().data or [])
        except Exception:
            rows = []
    else:
        rows = [r for r in _load_local() if r.get("owner") == owner]
    rows.sort(key=lambda r: r.get("bought_at", 0))
    return [_public(r) for r in rows]


def _tiles_from_crm(owner: str) -> list[dict]:
    """Build the client's map tiles from the CRM holdings (user_villas), so the
    admin and client are one connected system. A holding that isn't fully paid
    for yet is a `building` (under construction); a fully-funded one is a `villa`.

    NOTE: this only needs Supabase to be CONFIGURED — it must NOT depend on the
    legacy `estate_tiles` table existing (that table may be absent even when the
    CRM tables are present, which was silently hiding admin-mapped villas)."""
    try:
        from app.supabase_client import get_supabase
        cl = get_supabase()   # raises if Supabase isn't configured
        # owner (client auth key) → the CRM user id
        urows = cl.table("users").select("id").eq("owner", owner).limit(1).execute().data or []
        if not urows:
            return []
        uid = urows[0]["id"]
        holds = cl.table("user_villas").select("*").eq("user_id", uid).execute().data or []
        if not holds:
            return []
        villas = {v["id"]: v for v in (cl.table("villas").select("*").execute().data or [])}
        # invested per holding = sum of paid sip/lump_sum transactions
        txns = cl.table("transactions").select("user_villa_id,kind,amount,status").execute().data or []
        invested: dict[str, float] = {}
        for t in txns:
            if t.get("kind") in ("sip", "lump_sum") and t.get("status") == "paid":
                invested[t["user_villa_id"]] = invested.get(t["user_villa_id"], 0.0) + float(t.get("amount") or 0)
    except Exception:
        return []

    tiles: list[dict] = []
    for i, uv in enumerate(sorted(holds, key=lambda h: h.get("started_at", ""))):
        villa = villas.get(uv.get("villa_id"), {})
        price = float(villa.get("price") or 0)
        inv = float(invested.get(uv.get("id"), 0) or 0)
        cur = float(uv.get("current_value") or 0)
        sip = float(uv.get("sip_monthly") or 0)
        rent = float(villa.get("rent_monthly") or 0)
        fully_paid = uv.get("status") == "active" or (price > 0 and inv >= price)
        exited = uv.get("status") == "exited"
        # building = under construction; villa = built. (exited still shows as villa.)
        ttype = "villa" if (fully_paid or exited) else "building"
        tiles.append({
            "id": uv.get("id"),
            "type": ttype,
            "variant": "balanced",
            "cost": price,
            "sipMonthly": sip,
            "sipAccrued": round(inv),
            "rentMonthly": rent if (fully_paid and not exited) else 0,
            "currentValue": round(cur),
            "label": villa.get("name") or "Villa",
            "boughtAt": i,
        })
    return tiles


def save_tiles(owner: str, tiles: list[dict]) -> list[dict]:
    """Replace this user's whole estate with `tiles`. Returns the saved set."""
    cleaned = [_clean(t, owner) for t in (tiles or []) if t.get("id")]
    if _use_supabase():
        from app.supabase_client import get_supabase

        cl = get_supabase()
        cl.table(_TABLE).delete().eq("owner", owner).execute()
        if cleaned:
            cl.table(_TABLE).insert(cleaned).execute()
    else:
        others = [r for r in _load_local() if r.get("owner") != owner]
        _save_local(others + cleaned)
    return get_tiles(owner)
