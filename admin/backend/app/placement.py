"""Placement — which villa bucket every purchase builds, decided the moment a
Transaction Report is uploaded.

AssetPlus has no idea of villas: a client's lumpsum arrives as one set of lines
(₹14 L arbitrage, the rest spread over the other funds). What this module does:

  * A PURCHASE SET = one client's money-in lines on one day of one kind (SIP,
    Lumpsum …). Its COMPOSITION = each fund's share of the set's rupees.
  * Every bucket (recipe) in `villa_buckets` has a composition too (its funds'
    target weights). A set whose funds are the bucket's funds, with every share
    within TOL of the recipe, MATCHES that bucket → it is placed automatically:
    the shared allocation rule builds villas of that bucket only, splitting the
    set pro-rata across ₹5 L villas, and each villa carries the bucket's
    category (conservative / balanced / aggressive).
  * A set that matches no recipe (the funds changed — a gold fund was dropped,
    a new one added) is a DECISION. The admin picks a category → a new bucket is
    created from the set's own composition and the money is placed; or picks an
    existing bucket; or says "not a villa" (the money stays outside the villas).
    Every decision is remembered by order id, so a re-upload changes nothing.
  * Villas created by the rule are materialised as `client_villas` rows so they
    keep their name, category and bucket forever.

State lives in `admin_config` (no migration):
  placement_map   {order_id: bucket_id | "outside"}
  villa_buckets_map {villa_id: bucket_id}
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from app import reports as R
from app import villa_sales

PLACEMENT_KEY = "placement_map"
VILLA_BUCKET_KEY = "villa_buckets_map"
TOL = 0.05                     # a fund's share may sit 5 points off the recipe
CATEGORIES = {t["key"]: t for t in villa_sales.TYPES}
def _tier(b: dict | None) -> str | None:
    """A bucket's category key (buckets store 'Conservative' / 'conservative' alike)."""
    t = str((b or {}).get("tier") or "").strip().lower()
    return t if t in CATEGORIES else None


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ───────────────────────── state in admin_config ─────────────────────────
def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def _cfg(key: str) -> dict:
    try:
        rows = _sb().table("admin_config").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _cfg_set(key: str, value: dict) -> None:
    cl = _sb()
    cl.table("admin_config").delete().eq("key", key).execute()
    cl.table("admin_config").insert({"key": key, "value": value}).execute()


def placement_map() -> dict:
    return _cfg(PLACEMENT_KEY)


def villa_bucket_map() -> dict:
    return _cfg(VILLA_BUCKET_KEY)


# ───────────────────────── compositions ─────────────────────────
def _bucket_vectors(buckets: list[dict]) -> dict[str, dict[int, float]]:
    """{bucket_id: {scheme_code: share}} from the recipe's target weights (equal split if none)."""
    out: dict[str, dict[int, float]] = {}
    for b in buckets:
        funds = [f for f in (b.get("funds") or []) if f.get("scheme_code")]
        if not funds:
            continue
        ws = [float(f.get("target_weight") or 0) for f in funds]
        if sum(ws) <= 0:
            ws = [1.0] * len(funds)
        tot = sum(ws)
        vec: dict[int, float] = defaultdict(float)
        for f, w in zip(funds, ws):
            vec[int(f["scheme_code"])] += w / tot
        out[b["id"]] = dict(vec)
    return out


def _set_vector(lines: list[dict]) -> dict[int, float]:
    tot = sum(abs(float(l.get("amount") or 0)) for l in lines) or 1.0
    vec: dict[int, float] = defaultdict(float)
    for l in lines:
        if l.get("scheme_code"):
            vec[int(l["scheme_code"])] += abs(float(l.get("amount") or 0)) / tot
    return dict(vec)


def _similarity(a: dict[int, float], b: dict[int, float]) -> float:
    """1 = identical composition, 0 = nothing in common (half the L1 distance)."""
    keys = set(a) | set(b)
    return 1 - sum(abs(a.get(k, 0) - b.get(k, 0)) for k in keys) / 2


def _exact(a: dict[int, float], b: dict[int, float]) -> bool:
    return set(a) == set(b) and all(abs(a[k] - b[k]) <= TOL for k in a)


def _candidates(vec: dict[int, float], bvecs: dict, buckets: dict) -> list[dict]:
    out = []
    for bid, bv in bvecs.items():
        b = buckets.get(bid) or {}
        out.append({"bucket_id": bid, "name": b.get("name"), "tier": _tier(b), "kind": b.get("kind"),
                    "similarity": round(_similarity(vec, bv), 3), "exact": _exact(vec, bv)})
    out.sort(key=lambda c: -c["similarity"])
    return out


# ───────────────────────── purchase sets ─────────────────────────
def _sets(client_code: str, txns: list[dict], pmap: dict, villas_by_id: dict) -> list[dict]:
    """The client's money-in sets that have no decision yet, newest first."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for t in txns:
        if t.get("order_id") in pmap:
            continue
        if t.get("villa_id") and str(t["villa_id"]) in villas_by_id:
            continue                                     # an old hand pin stays as it is
        from app.shared_alloc import villa_alloc
        if villa_alloc.txn_sign(t.get("kind")) < 0 or not t.get("scheme_code"):
            continue
        if str(t.get("order_id") or "").startswith("MAN-"):
            continue
        day = str(t.get("txn_date") or "")[:10]
        groups[(day, (t.get("kind") or "").strip().lower())].append(t)
    out = []
    for (day, kind), lines in groups.items():
        total = sum(abs(float(l.get("amount") or 0)) for l in lines)
        if total <= 0:
            continue
        vec = _set_vector(lines)
        out.append({
            "key": f"{client_code}|{day}|{kind}", "client_code": client_code, "day": day, "kind": kind,
            "total": round(total, 2), "order_ids": [l["order_id"] for l in lines],
            "lines": sorted([{"order_id": l["order_id"], "scheme_code": l.get("scheme_code"), "scheme_name": l.get("scheme_name"),
                              "amount": round(abs(float(l.get("amount") or 0)), 2), "share": round(vec.get(int(l["scheme_code"]), 0), 4)}
                             for l in lines], key=lambda x: -x["amount"]),
            "vector": vec,
        })
    out.sort(key=lambda s: s["day"], reverse=True)
    return out


def _all_txns() -> dict[str, list[dict]]:
    by: dict[str, list[dict]] = defaultdict(list)
    for t in R._all_rows("client_transactions", "*"):
        by[t.get("client_code")].append(t)
    return by


def _all_villas() -> dict[str, list[dict]]:
    by: dict[str, list[dict]] = defaultdict(list)
    for v in R._all_rows("client_villas", "*"):
        by[v.get("client_code")].append(v)
    return by


# ───────────────────────── materialise villas ─────────────────────────
def materialise(client_code: str, *, villas: list[dict] | None = None, txns: list[dict] | None = None) -> int:
    """Turn the rule's virtual villas into client_villas rows that carry their
    bucket and category, so names and types stick. Returns rows created."""
    if villas is None:
        villas = _all_villas().get(client_code, [])
    if txns is None:
        txns = _all_txns().get(client_code, [])
    r = R.allocate_client(client_code, villas=villas, txns=txns)
    vb = villa_bucket_map()
    types = villa_sales.get_types()
    buckets = {b["id"]: b for b in R.list_buckets()}
    created = 0
    vb_changed = types_changed = False
    for h in r["houses"]:
        if h["auto"]:
            row = R.create_client_villa(client_code, h.get("name") or "Villa")
            vid = row["id"]
            created += 1
        else:
            vid = h["villa_id"]
        b = h.get("bucket")
        if b and b != "outside" and vb.get(vid) != b:
            vb[vid] = b
            vb_changed = True
        tier = _tier(buckets.get(b)) if b else None
        if tier and types.get(vid) != tier:
            types[vid] = tier
            types_changed = True
    if vb_changed:
        _cfg_set(VILLA_BUCKET_KEY, vb)
    if types_changed:
        _cfg_set(villa_sales.TYPES_KEY, types)
    return created


# ───────────────────────── the engine ─────────────────────────
def run(client_codes: list[str] | None = None) -> dict:
    """Auto-place every set that matches a recipe; list the rest as decisions."""
    buckets = R.list_buckets()
    bmap = {b["id"]: b for b in buckets}
    bvecs = _bucket_vectors(buckets)
    pmap = placement_map()
    all_t, all_v = _all_txns(), _all_villas()
    codes = client_codes or [c for c in all_t if c != R.DEMO_CODE]
    auto, pending = [], []
    changed = False
    clients = {c["client_code"]: c for c in R._all_clients()}
    for code in codes:
        if code == R.DEMO_CODE:
            continue
        txns = all_t.get(code, [])
        vbyid = {str(v["id"]): v for v in all_v.get(code, [])}
        touched = False
        for s in _sets(code, txns, pmap, vbyid):
            cands = _candidates(s["vector"], bvecs, bmap)
            exact = [c for c in cands if c["exact"]]
            name = (clients.get(code, {}).get("name") or code).strip()
            if len(exact) == 1 or (exact and len({c["tier"] for c in exact}) == 1):
                bid = exact[0]["bucket_id"]
                for oid in s["order_ids"]:
                    pmap[oid] = bid
                changed = touched = True
                auto.append({**_public(s), "client_name": name, "bucket": _bucket_public(bmap[bid])})
            else:
                pending.append({**_public(s), "client_name": name, "candidates": cands[:4],
                                "suggested": _suggest(cands)})
        if touched:
            _cfg_set(PLACEMENT_KEY, pmap)
            materialise(code, villas=all_v.get(code, []), txns=txns)
    if changed:
        _cfg_set(PLACEMENT_KEY, pmap)
    pending.sort(key=lambda s: (s["day"], s["total"]), reverse=True)
    for s in pending:
        s["exact"] = False
    return {"auto": auto, "auto_count": len(auto), "pending": pending, "count": len(pending),
            "amount": round(sum(s["total"] for s in pending), 2),
            "buckets": [_bucket_public(b) for b in buckets], "categories": villa_sales.TYPES}


def pending(client_codes: list[str] | None = None) -> dict:
    """What still needs a decision (no writes)."""
    buckets = R.list_buckets()
    bmap = {b["id"]: b for b in buckets}
    bvecs = _bucket_vectors(buckets)
    pmap = placement_map()
    all_t, all_v = _all_txns(), _all_villas()
    clients = {c["client_code"]: c for c in R._all_clients()}
    out = []
    for code in (client_codes or [c for c in all_t if c != R.DEMO_CODE]):
        if code == R.DEMO_CODE:
            continue
        vbyid = {str(v["id"]): v for v in all_v.get(code, [])}
        name = (clients.get(code, {}).get("name") or code).strip()
        for s in _sets(code, all_t.get(code, []), pmap, vbyid):
            cands = _candidates(s["vector"], bvecs, bmap)
            out.append({**_public(s), "client_name": name, "candidates": cands[:4], "suggested": _suggest(cands),
                        "exact": bool(cands and cands[0]["exact"])})
    out.sort(key=lambda s: (s["day"], s["total"]), reverse=True)
    return {"pending": out, "count": len(out), "amount": round(sum(s["total"] for s in out), 2),
            "buckets": [_bucket_public(b) for b in buckets], "categories": villa_sales.TYPES}


def _suggest(cands: list[dict]) -> dict | None:
    if not cands:
        return None
    best = cands[0]
    return {"bucket_id": best["bucket_id"], "name": best["name"], "tier": best["tier"], "similarity": best["similarity"]}


def _public(s: dict) -> dict:
    return {k: v for k, v in s.items() if k != "vector"}


def _bucket_public(b: dict) -> dict:
    funds = [f for f in (b.get("funds") or []) if f.get("scheme_code")]
    ws = [float(f.get("target_weight") or 0) for f in funds]
    if sum(ws) <= 0:
        ws = [1.0] * len(funds)
    tot = sum(ws) or 1
    return {"id": b["id"], "name": b.get("name"), "tier": _tier(b), "kind": b.get("kind"),
            "funds": [{"scheme_code": f["scheme_code"], "scheme_name": f.get("scheme_name"), "sleeve": f.get("sleeve"),
                       "share": round(w / tot, 4)} for f, w in zip(funds, ws)]}


# ───────────────────────── decisions ─────────────────────────
_SLEEVE_WORDS = [("arbitrage", "arbitrage"), ("gold", "gold"), ("small", "small"), ("mid", "mid"),
                 ("large", "large"), ("bluechip", "large"), ("top 100", "large"), ("nifty 50", "large")]


def _sleeve_for(code: int, name: str, buckets: list[dict]) -> str | None:
    for b in buckets:
        for f in b.get("funds") or []:
            if f.get("scheme_code") == code and f.get("sleeve"):
                return f["sleeve"]
    n = (name or "").lower()
    for word, sleeve in _SLEEVE_WORDS:
        if word in n:
            return sleeve
    return "other"


def _bucket_name(category: str, day: str, existing: list[dict]) -> str:
    try:
        d = datetime.fromisoformat(day)
        stamp = f"{_MONTHS[d.month - 1]} {str(d.year)[2:]}"
    except Exception:
        stamp = datetime.now(timezone.utc).strftime("%b %y")
    base = f"{CATEGORIES[category]['name']} · {stamp}"
    names = {b.get("name") for b in existing}
    name, n = base, 2
    while name in names:
        name = f"{base} ({n})"
        n += 1
    return name


def decide(order_ids: list[str], action: str, *, category: str | None = None, bucket_id: str | None = None,
           name: str | None = None) -> dict:
    """One decision for a purchase set.
    action = 'category' (new bucket from the set's own mix) · 'bucket' (an existing one) · 'outside'."""
    if not order_ids:
        raise ValueError("Nothing to decide.")
    rows = R._all_rows("client_transactions", "*")
    lines = [t for t in rows if t.get("order_id") in set(order_ids)]
    if not lines:
        raise ValueError("Those transactions are not on record.")
    client_code = lines[0].get("client_code")
    pmap = placement_map()
    made = None
    if action == "outside":
        target = "outside"
    elif action == "bucket":
        if not bucket_id or bucket_id not in {b["id"] for b in R.list_buckets()}:
            raise ValueError("Pick a bucket.")
        target = bucket_id
    elif action == "category":
        if category not in CATEGORIES:
            raise ValueError("Category must be conservative, balanced or aggressive.")
        buckets = R.list_buckets()
        vec = _set_vector(lines)
        by_code: dict[int, str] = {}
        for l in lines:
            if l.get("scheme_code"):
                by_code.setdefault(int(l["scheme_code"]), l.get("scheme_name") or "")
        funds = [{"scheme_code": code, "scheme_name": nm, "target_weight": round(vec.get(code, 0) * 100, 2),
                  "sleeve": _sleeve_for(code, nm, buckets)} for code, nm in by_code.items()]
        funds.sort(key=lambda f: -f["target_weight"])
        kind = "lumpsum" if "lump" in (lines[0].get("kind") or "").lower() else "sip"
        day = str(lines[0].get("txn_date") or "")[:10]
        made = R.create_bucket((name or "").strip() or _bucket_name(category, day, buckets), category, funds, kind=kind)
        target = made["id"]
    else:
        raise ValueError("Unknown action.")
    for oid in order_ids:
        pmap[oid] = target
    _cfg_set(PLACEMENT_KEY, pmap)
    materialise(client_code)
    R._VC["at"] = 0.0                     # a new bucket may add villa funds
    return {"ok": True, "client_code": client_code, "bucket": _bucket_public(made) if made else None,
            **pending([client_code])}


def undo(order_ids: list[str]) -> dict:
    pmap = placement_map()
    for oid in order_ids:
        pmap.pop(oid, None)
    _cfg_set(PLACEMENT_KEY, pmap)
    return {"ok": True}
