"""Villas sold — how many Conservative / Balanced / Aggressive villas clients hold,
what they're worth today and the commission they earn.

Each client villa gets a TYPE (the calculator settings' villa keys:
conservative / balanced / aggressive). The type map lives in the `admin_config`
key/value table under TYPES_KEY — {villa_id: type} — so no migration is needed.
Villas without a type are counted separately so the admin can set them.

Value = the villa's pinned transactions at today's NAV (as the Clients drawer
shows). Commission a year = each pinned fund's value × that fund's trail rate
from the Commission page.
"""

from __future__ import annotations

from app import reports as reports_svc

TYPES_KEY = "villa_types"
TYPES = [
    {"key": "conservative", "name": "Conservative", "risk": "Low"},
    {"key": "balanced", "name": "Balanced", "risk": "Medium"},
    {"key": "aggressive", "name": "Aggressive", "risk": "High"},
]
_KEYS = {t["key"] for t in TYPES}


def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def get_types() -> dict[str, str]:
    try:
        rows = _sb().table("admin_config").select("value").eq("key", TYPES_KEY).limit(1).execute().data or []
        v = rows[0]["value"] if rows and isinstance(rows[0].get("value"), dict) else {}
        return {k: t for k, t in v.items() if t in _KEYS}
    except Exception:
        return {}


def set_type(villa_id: str, vtype: str | None) -> dict[str, str]:
    if vtype is not None and vtype not in _KEYS:
        raise ValueError("Type must be conservative, balanced or aggressive.")
    types = get_types()
    if vtype:
        types[villa_id] = vtype
    else:
        types.pop(villa_id, None)
    cl = _sb()
    cl.table("admin_config").delete().eq("key", TYPES_KEY).execute()
    cl.table("admin_config").insert({"key": TYPES_KEY, "value": types}).execute()
    return types


def summary() -> dict:
    """Villas by CATEGORY and by BUCKET (recipe): count, value, invested and the
    commission they earn — every villa's holdings at today's NAV × each fund's
    trail rate. A bucket row also carries what ONE ₹5 L villa of that recipe
    earns a month, so the admin sees the commission of each recipe they sell."""
    from app import commission as commission_svc
    from app import placement
    types = get_types()
    vbmap = placement.villa_bucket_map()
    rates = (commission_svc.get_rates().get("rates") or {})
    R = reports_svc
    unit = R._villa_unit()
    all_buckets = R.list_buckets()
    cat = {t["key"]: {**t, "count": 0, "constructed": 0, "value": 0.0, "invested": 0.0, "commission": 0.0} for t in TYPES}
    brow: dict[str, dict] = {}
    for b in all_buckets:
        funds = [f for f in (b.get("funds") or []) if f.get("scheme_code")]
        ws = [float(f.get("target_weight") or 0) for f in funds]
        if sum(ws) <= 0:
            ws = [1.0] * len(funds)
        tot = sum(ws) or 1
        per_year_pct = 0.0
        missing = []
        for f, w in zip(funds, ws):
            r = rates.get(str(f["scheme_code"]))
            if r is None:
                missing.append(f.get("scheme_name"))
            per_year_pct += (w / tot) * (r or 0)
        brow[b["id"]] = {"bucket_id": b["id"], "name": b.get("name"), "tier": placement._tier(b), "kind": b.get("kind"),
                         "count": 0, "constructed": 0, "value": 0.0, "invested": 0.0, "commission": 0.0,
                         "rate_pct": round(per_year_pct, 4), "per_villa_month": round(unit * per_year_pct / 100 / 12, 2),
                         "per_villa_year": round(unit * per_year_pct / 100, 2), "rates_missing": missing,
                         "funds": [{"scheme_code": f["scheme_code"], "scheme_name": f.get("scheme_name"), "sleeve": f.get("sleeve"),
                                    "share": round(w / tot, 4), "rate_pct": rates.get(str(f["scheme_code"]))} for f, w in zip(funds, ws)]}
    unset = {"count": 0, "value": 0.0, "villas": []}
    all_villas: dict[str, list] = {}
    all_txns: dict[str, list] = {}
    for v in R._all_rows("client_villas", "*"):
        all_villas.setdefault(v.get("client_code"), []).append(v)
    for t in R._all_rows("client_transactions", "*"):
        all_txns.setdefault(t.get("client_code"), []).append(t)
    R.prime_navs(t.get("scheme_code") for ts in all_txns.values() for t in ts if t.get("scheme_code"))
    for c in R._all_clients():
        code = c["client_code"]
        if code == R.DEMO_CODE or not all_txns.get(code):
            continue
        txns = all_txns.get(code, [])
        villas = R.list_client_villas(code, villas=all_villas.get(code, []), txns=txns, vtypes=types)
        for v in villas:
            if not v.get("funds"):
                continue
            comm = 0.0
            for h in v["funds"]:
                r = rates.get(str(h.get("scheme_code"))) if h.get("scheme_code") else None
                if r is None:
                    continue
                nav = R.live_nav(h["scheme_code"])[0]
                val = (h.get("units") or 0) * nav if nav else (h.get("invested") or 0)
                comm += val * r / 100
            bid = v.get("bucket_id") or vbmap.get(v["id"])
            t_key = types.get(v["id"]) or ((brow.get(bid) or {}).get("tier") if bid else None)
            if bid in brow:
                b = brow[bid]
                b["count"] += 1
                b["constructed"] += 1 if v.get("finished") else 0
                b["value"] += v.get("value") or 0
                b["invested"] += v.get("mapped_total") or 0
                b["commission"] += comm
            if t_key in cat:
                b = cat[t_key]
                b["count"] += 1
                b["constructed"] += 1 if v.get("finished") else 0
                b["value"] += v.get("value") or 0
                b["invested"] += v.get("mapped_total") or 0
                b["commission"] += comm
            else:
                unset["count"] += 1
                unset["value"] += v.get("value") or 0
                unset["villas"].append({"villa_id": v["id"], "client_code": code,
                                        "client_name": (c.get("name") or code).strip(), "name": v.get("name"),
                                        "value": v.get("value") or 0})
    rows = list(cat.values())
    for b in rows + list(brow.values()):
        for k in ("value", "invested", "commission"):
            b[k] = round(b[k], 2)
    return {
        "types": rows,
        "buckets": sorted(brow.values(), key=lambda b: (-b["count"], -b["value"])),
        "unit": unit,
        "unset": {**unset, "value": round(unset["value"], 2)},
        "totals": {
            "count": sum(b["count"] for b in rows) + unset["count"],
            "value": round(sum(b["value"] for b in rows) + unset["value"], 2),
            "commission": round(sum(b["commission"] for b in rows), 2),
        },
    }
