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
    from app import commission as commission_svc
    types = get_types()
    rates = (commission_svc.get_rates().get("rates") or {})
    buckets = {t["key"]: {**t, "count": 0, "constructed": 0, "value": 0.0, "invested": 0.0, "commission": 0.0}
               for t in TYPES}
    unset = {"count": 0, "value": 0.0, "villas": []}
    villa_rows: list[dict] = []          # every client villa with money in it, with its funds
    # every client's villas and transactions in two reads (not two per client),
    # and every pinned fund's NAV in one batched lookup
    R = reports_svc
    all_villas: dict[str, list] = {}
    all_txns: dict[str, list] = {}
    for v in R._all_rows("client_villas", "*"):
        all_villas.setdefault(v.get("client_code"), []).append(v)
    for t in R._all_rows("client_transactions", "*"):
        all_txns.setdefault(t.get("client_code"), []).append(t)
    R.prime_navs(t.get("scheme_code") for ts in all_txns.values() for t in ts if t.get("villa_id"))
    for c in R._all_clients():
        code = c["client_code"]
        if code == R.DEMO_CODE or not all_villas.get(code):
            continue
        txns = sorted(all_txns.get(code, []), key=lambda t: str(t.get("txn_date") or ""), reverse=True)
        villas = R.list_client_villas(code, villas=all_villas[code], txns=txns, vtypes=types)
        # commission per villa: its pinned funds at today's NAV × each fund's rate —
        # kept per fund too, so the Commission tab can show what each villa is made of
        for v in villas:
            items = [t for t in txns if t.get("villa_id") == v["id"]]
            comm = 0.0
            funds: dict[str, dict] = {}
            for t in items:
                sc = t.get("scheme_code")
                k = commission_svc._key(sc, t.get("scheme_name"))   # same key as the fund table
                r = rates.get(k)
                nav = reports_svc.live_nav(sc)[0] if sc else None
                units = reports_svc._signed(t, "units")
                val = units * nav if nav else reports_svc._signed(t, "amount")
                f = funds.setdefault(k, {
                    "key": k, "scheme_code": sc, "scheme_name": t.get("scheme_name") or "Fund",
                    "units": 0.0, "nav": nav, "value": 0.0, "invested": 0.0, "rate_pct": r, "yearly": 0.0,
                })
                f["units"] += units
                f["value"] += val
                f["invested"] += reports_svc._signed(t, "amount")
                if r is not None:
                    f["yearly"] += val * r / 100
                    comm += val * r / 100
            t_key = types.get(v["id"])
            if items:
                villa_rows.append({
                    "villa_id": v["id"], "client_code": code, "client_name": (c.get("name") or code).strip(),
                    "label": ("Villa " if v.get("finished") else "Plot ") + str((v.get("position") or 0) + 1),
                    "finished": bool(v.get("finished")), "type": t_key, "since": v.get("since") or "",
                    "value": round(v.get("value") or 0, 2), "invested": round(v.get("mapped_total") or 0, 2),
                    "commission": round(comm, 2),
                    "funds": sorted(
                        [{**f, "units": round(f["units"], 4), "value": round(f["value"], 2),
                          "invested": round(f["invested"], 2), "yearly": round(f["yearly"], 2)} for f in funds.values()],
                        key=lambda f: -f["value"]),
                })
            if t_key:
                b = buckets[t_key]
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
    rows = list(buckets.values())
    for b in rows:
        for k in ("value", "invested", "commission"):
            b[k] = round(b[k], 2)
    villa_rows.sort(key=lambda v: (v["client_name"].lower(), not v["finished"], v["since"] or "9999"))
    return {
        "types": rows,
        "villas": villa_rows,
        "unset": {**unset, "value": round(unset["value"], 2)},
        "totals": {
            "count": sum(b["count"] for b in rows) + unset["count"],
            "value": round(sum(b["value"] for b in rows) + unset["value"], 2),
            "commission": round(sum(b["commission"] for b in rows), 2),
        },
    }
