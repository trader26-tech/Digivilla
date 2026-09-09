"""Villa SIP — the canonical villa (a.k.a. "bucket") the client sees.

SINGLE SOURCE OF TRUTH: the admin app defines each villa in the shared Supabase
tables ``villa_buckets`` + ``villa_bucket_funds`` (name, tier, and per-fund
scheme_code / category / allocation %). The client reads the SAME tables here —
there is no second copy of the villa mix.

Per-fund PAST RETURNS (1Y / 3Y / 5Y) are NOT taken from anything typed by the
admin; they are computed LIVE from real mfapi.in NAV history (same engine the
fund dashboard uses), so the SIP modal always shows current numbers. The
"Overall Portfolio Returns" row is the allocation-weighted blend of those.

Powers the client SIP modal:
    Scheme Name · Category · Allocation · Past Returns (1Y / 3Y / 5Y)
    ────────────────────────────────────────────────────────────────
    Overall Portfolio Returns          100%      w-avg 1Y/3Y/5Y
"""

from __future__ import annotations

import time
from typing import Optional


# ── live-return cache ────────────────────────────────────────────────────────
# One mfapi round-trip per scheme is enough for the whole modal; cache the
# computed windows for a few hours so re-opening the modal is instant and we
# never hammer mfapi. { scheme_code: (fetched_at, {"1y":.., "3y":.., "5y":..}) }
_RET_TTL_SECONDS = 6 * 3600
_ret_cache: dict[int, tuple[float, dict]] = {}


def _live_returns(scheme_code: int) -> dict:
    """Annualized 1Y/3Y/5Y return (% p.a.) for a scheme, from live NAV history.

    Returns {"ret_1y": float|None, "ret_3y": ..., "ret_5y": ...}. On any failure
    (unknown code, mfapi down) the values are None so the modal degrades to "—".
    """
    if not scheme_code:
        return {"ret_1y": None, "ret_3y": None, "ret_5y": None}

    now = time.time()
    hit = _ret_cache.get(scheme_code)
    if hit and now - hit[0] < _RET_TTL_SECONDS:
        return hit[1]

    out = {"ret_1y": None, "ret_3y": None, "ret_5y": None}
    try:
        from app import dashboard
        nav = dashboard.get_nav_windows(scheme_code)
        if nav:
            for w in nav.windows:
                # cagr_pct is annualized for windows >= 1y; the 1y window's
                # simple change equals its CAGR over ~1 year.
                val = w.cagr_pct if w.cagr_pct is not None else w.change_pct
                if w.window == "1y":
                    out["ret_1y"] = val
                elif w.window == "3y":
                    out["ret_3y"] = val
                elif w.window == "5y":
                    out["ret_5y"] = val
    except Exception:
        pass

    _ret_cache[scheme_code] = (now, out)
    return out


def _to_pct_weight(w) -> float:
    """Normalize a stored weight into a 0..100 percentage.

    Admin buckets store target_weight already as a percentage (e.g. 36).
    The legacy villa_funds table stored fractions (e.g. 0.36). Accept both.
    """
    try:
        w = float(w or 0)
    except (TypeError, ValueError):
        return 0.0
    return round(w * 100, 2) if 0 < w <= 1 else round(w, 2)


def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def list_villas() -> list[dict]:
    """All canonical villas (id, name, tier, fund count) for a picker/list."""
    try:
        buckets = _sb().table("villa_buckets").select("*").order("sort_order").execute().data or []
        funds = _sb().table("villa_bucket_funds").select("bucket_id").execute().data or []
    except Exception:
        return []
    count: dict[str, int] = {}
    for f in funds:
        count[f["bucket_id"]] = count.get(f["bucket_id"], 0) + 1
    return [
        {"id": b["id"], "name": b.get("name"), "tier": b.get("tier"),
         "fund_count": count.get(b["id"], 0)}
        for b in buckets
    ]


def villa_sip(bucket_id: str) -> Optional[dict]:
    """The SIP modal payload for one villa: its funds with category + allocation
    + LIVE 1/3/5-Yr returns, plus the allocation-weighted overall returns."""
    try:
        buckets = _sb().table("villa_buckets").select("*").eq("id", bucket_id).limit(1).execute().data or []
        if not buckets:
            return None
        bucket = buckets[0]
        rows = _sb().table("villa_bucket_funds").select("*").eq(
            "bucket_id", bucket_id).order("sort_order").execute().data or []
    except Exception:
        return None

    funds: list[dict] = []
    wsum = {"1y": 0.0, "3y": 0.0, "5y": 0.0}
    weight = {"1y": 0.0, "3y": 0.0, "5y": 0.0}
    alloc_total = 0.0
    for r in rows:
        alloc = _to_pct_weight(r.get("target_weight"))
        alloc_total += alloc
        rets = _live_returns(r.get("scheme_code"))
        funds.append({
            "scheme_name": r.get("scheme_name"),
            "scheme_code": r.get("scheme_code"),
            "category": r.get("category") or "Other",
            "allocation": alloc,
            "ret_1y": rets["ret_1y"],
            "ret_3y": rets["ret_3y"],
            "ret_5y": rets["ret_5y"],
        })
        # weighted overall over funds that actually have each window's return
        for key, rk in (("1y", "ret_1y"), ("3y", "ret_3y"), ("5y", "ret_5y")):
            if rets[rk] is not None and alloc > 0:
                wsum[key] += rets[rk] * alloc
                weight[key] += alloc

    overall = {
        f"ret_{k}": (round(wsum[k] / weight[k], 2) if weight[k] else None)
        for k in ("1y", "3y", "5y")
    }

    return {
        "id": bucket["id"],
        "name": bucket.get("name"),
        "tier": bucket.get("tier"),
        "allocation_total": round(alloc_total, 2),
        "funds": funds,
        "overall": overall,
    }
