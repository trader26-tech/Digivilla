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
AUTO_LOG_KEY = "placement_auto_log"     # what the engine placed by itself, newest first (shown with Undo for 14 days)
VILLA_BUCKET_KEY = "villa_buckets_map"
TOL = 0.05                     # a fund's share may sit 5 points off the recipe
CATEGORIES = {t["key"]: t for t in villa_sales.TYPES}
def _tier(b: dict | None) -> str | None:
    """A bucket's category key (buckets store 'Conservative' / 'conservative' alike)."""
    t = str((b or {}).get("tier") or "").strip().lower()
    return t if t in CATEGORIES else None


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SLACK = 0.01                   # a villa may land this far short of ₹unit: stamp duty (0.005 %) and rupee rounding


def whole_villas(total: float, unit: float) -> tuple[int, float]:
    """(k, short) when `total` is k whole villas within SLACK — ₹4,99,975 is one ₹5 L villa,
    ₹25 short (the stamp duty AssetPlus deducts); (0, 0) when it is not a round number of villas."""
    if not unit or total <= 0:
        return 0, 0.0
    k = int(round(total / unit))
    if k >= 1 and abs(k * unit - total) <= unit * SLACK:
        return k, round(k * unit - total, 2)
    return 0, 0.0


def infer_tier(vec: dict[int, float], lines: list[dict], buckets: list[dict]) -> str | None:
    """The category a fresh mix belongs to, from its arbitrage share (the income part):
    ≥ 55 % conservative · ≥ 25 % balanced · else aggressive. None when a fund is not a villa fund."""
    arb = 0.0
    for l in lines:
        code = int(l.get("scheme_code") or 0)
        sleeve = _sleeve_for(code, l.get("scheme_name") or "", buckets)
        if sleeve in (None, "other"):
            return None
        if sleeve == "arbitrage":
            arb += vec.get(code, 0.0)
    return "conservative" if arb >= 0.55 else "balanced" if arb >= 0.25 else "aggressive"



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
    unit = R._villa_unit()
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
                k, _short = whole_villas(s["total"], unit)
                tier = infer_tier(s["vector"], s["lines"], buckets) if k else None
                if tier:                                    # whole villas of villa funds: a new recipe, placed now
                    lines = [t for t in txns if t.get("order_id") in set(s["order_ids"])]
                    made = _new_recipe(lines, tier, None, buckets)
                    buckets = R.list_buckets(); bmap = {b["id"]: b for b in buckets}; bvecs = _bucket_vectors(buckets)
                    for oid in s["order_ids"]:
                        pmap[oid] = made["id"]
                    changed = touched = True
                    auto.append({**_public(s), "client_name": name, "bucket": _bucket_public(made), "new_recipe": True, "tier": tier})
                else:
                    pending.append({**_public(s), "client_name": name, "candidates": cands[:4],
                                    "suggested": _suggest(cands), "tier": infer_tier(s["vector"], s["lines"], buckets)})
        if touched:
            _cfg_set(PLACEMENT_KEY, pmap)
            materialise(code, villas=all_v.get(code, []), txns=txns)
    if changed:
        _cfg_set(PLACEMENT_KEY, pmap)
    if auto:
        _log_auto(auto)
    pending.sort(key=lambda s: (s["day"], s["total"]), reverse=True)
    for s in pending:
        s["exact"] = False
    return {"auto": auto, "auto_count": len(auto), "recent": recent_auto(), "pending": pending, "count": len(pending),
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
                        "exact": bool(cands and cands[0]["exact"]), "tier": infer_tier(s["vector"], s["lines"], buckets)})
    out.sort(key=lambda s: (s["day"], s["total"]), reverse=True)
    return {"pending": out, "count": len(out), "amount": round(sum(s["total"] for s in out), 2), "recent": recent_auto(),
            "buckets": [_bucket_public(b) for b in buckets], "categories": villa_sales.TYPES}


def _log_auto(entries: list[dict]) -> None:
    """Remember what the engine placed by itself (newest first, 60 kept)."""
    log = list((_cfg(AUTO_LOG_KEY) or {}).get("items") or [])
    stamp = datetime.now(timezone.utc).isoformat()
    for e in entries:
        log.insert(0, {"at": stamp, **{k: v for k, v in e.items() if k in
                       ("key", "client_code", "client_name", "day", "kind", "total", "order_ids", "lines", "villas", "short", "unit", "bucket", "new_recipe", "tier")}})
    _cfg_set(AUTO_LOG_KEY, {"items": log[:60]})


def recent_auto(days: int = 14) -> list[dict]:
    """The engine's own placements of the last `days`, still in force."""
    pmap = placement_map()
    cutoff = datetime.now(timezone.utc).timestamp() - days * 86400
    out = []
    for e in (_cfg(AUTO_LOG_KEY) or {}).get("items") or []:
        try:
            if datetime.fromisoformat(e["at"]).timestamp() < cutoff:
                continue
        except Exception:
            continue
        if not all(oid in pmap for oid in e.get("order_ids") or []):
            continue                                        # undone, or decided afresh
        out.append(e)
    return out


def _suggest(cands: list[dict]) -> dict | None:
    if not cands:
        return None
    best = cands[0]
    return {"bucket_id": best["bucket_id"], "name": best["name"], "tier": best["tier"], "similarity": best["similarity"]}


def _public(s: dict) -> dict:
    unit = R._villa_unit()
    k, short = whole_villas(float(s.get("total") or 0), unit)
    return {**{k2: v for k2, v in s.items() if k2 != "vector"}, "villas": k, "short": short, "unit": unit}


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


def _new_recipe(lines: list[dict], category: str, name: str | None, buckets: list[dict]) -> dict:
    """A bucket (recipe) made from a purchase set's own mix, named '<Category> · Oct 26'."""
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
    R._VC["at"] = 0.0                     # a new bucket may add villa funds
    return made


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
        made = _new_recipe(lines, category, name, R.list_buckets())
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
