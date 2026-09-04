"""Basket suggestion + persistence.

A "basket" is a user-owned set of funds (with weights) that they intend to
invest in, optionally linked to a goal. The system can *suggest* a basket from
the goal's risk profile: it picks an asset-class allocation, then fills each
sleeve with the top-rated Regular-plan funds from the research universe. The
user can then edit funds/weights and save.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from app import dashboard
from app.schemas import (
    Basket,
    BasketCreate,
    BasketItem,
    BasketSuggestResponse,
)

_LOCAL_PATH = os.path.join(os.path.dirname(__file__), "data", "baskets.json")


# ---------------- suggestion engine ----------------

# Asset-class allocation by risk profile (equity / hybrid / debt / gold).
ALLOCATIONS: dict[str, dict[str, float]] = {
    "conservative": {"equity": 0.25, "hybrid": 0.30, "debt": 0.40, "gold": 0.05},
    "balanced": {"equity": 0.55, "hybrid": 0.20, "debt": 0.20, "gold": 0.05},
    "aggressive": {"equity": 0.80, "hybrid": 0.10, "debt": 0.05, "gold": 0.05},
}

# Within an asset class, which buckets to prefer (in order) and how many funds.
SLEEVE_BUCKETS: dict[str, list[str]] = {
    "equity": ["Flexi Cap", "Large Cap", "Mid Cap", "Small Cap", "Large & Mid Cap"],
    "hybrid": ["Balanced Advantage", "Aggressive Hybrid", "Multi Asset"],
    "debt": ["Corporate Bond", "Short / Low Duration", "Gilt"],
    "gold": ["Gold"],
}


def suggest(risk: str) -> BasketSuggestResponse:
    risk = risk if risk in ALLOCATIONS else "balanced"
    allocation = ALLOCATIONS[risk]
    funds = dashboard.all_funds()

    items: list[BasketItem] = []
    for asset_class, sleeve_weight in allocation.items():
        if sleeve_weight <= 0:
            continue
        # Collect the best-rated fund from each preferred bucket in this sleeve.
        # Equity picks tilt by risk: conservative -> large-cap, aggressive -> mid/small.
        picks = _top_for_sleeve(funds, asset_class, risk=risk)
        if not picks:
            continue
        # Split the sleeve weight across its picks (favor the first).
        per = _split_weight(sleeve_weight, len(picks))
        for fund, w in zip(picks, per):
            items.append(
                BasketItem(
                    scheme_code=fund.scheme_code,
                    name=fund.name,
                    fund_house=fund.fund_house,
                    bucket=fund.bucket,
                    asset_class=fund.asset_class,
                    rating=fund.rating,
                    return_1y=fund.return_1y,
                    return_3y=fund.return_3y,
                    return_5y=fund.return_5y,
                    weight=round(w, 4),
                    sleeve=asset_class,
                    rationale=_fund_reason(fund, asset_class),
                )
            )

    _normalize_weights(items)
    note = _why_this_mix(risk, allocation)
    return BasketSuggestResponse(
        risk=risk, allocation=allocation, items=items, note=note
    )


def _fund_reason(fund, asset_class: str) -> str:
    """One-line, evidence-based reason this fund was chosen."""
    bits = []
    if fund.rating >= 5:
        bits.append("top-rated in its category")
    elif fund.rating == 4:
        bits.append("highly rated in its category")
    if fund.return_5y is not None:
        bits.append(f"5Y {fund.return_5y:.0f}% CAGR")
    elif fund.return_3y is not None:
        bits.append(f"3Y {fund.return_3y:.0f}% CAGR")
    if fund.max_drawdown is not None and fund.asset_class == "equity" and fund.max_drawdown > -45:
        bits.append("contained drawdowns")
    if fund.volatility is not None and fund.asset_class == "debt" and fund.volatility < 4:
        bits.append("very low volatility")
    role = {
        "equity": "drives long-term growth",
        "hybrid": "cushions volatility",
        "debt": "adds stability & income",
        "gold": "hedges against equity falls",
        "cash": "keeps money accessible",
    }.get(asset_class, "")
    lead = ", ".join(bits) if bits else f"solid {fund.bucket} option"
    return f"{lead[0].upper()}{lead[1:]} — {role}." if role else f"{lead}."


def _why_this_mix(risk: str, allocation: dict) -> str:
    eq = int(allocation.get("equity", 0) * 100)
    debt = int((allocation.get("debt", 0) + allocation.get("cash", 0)) * 100)
    hyb = int(allocation.get("hybrid", 0) * 100)
    if risk == "conservative":
        return (
            f"Conservative: only {eq}% equity with {debt}% debt and {hyb}% hybrid, so "
            "day-to-day swings and worst-case falls stay small. Chosen for capital "
            "protection over a shorter horizon — not for chasing the highest returns."
        )
    if risk == "aggressive":
        return (
            f"Aggressive: {eq}% equity (tilted to mid/small caps) for maximum long-term "
            "growth. We accept deeper drawdowns because a long horizon gives time to "
            "recover — that's why there's little debt here."
        )
    return (
        f"Balanced: {eq}% equity for growth with {debt + hyb}% in debt/hybrid as a "
        "shock-absorber. A middle path — meaningfully more return than conservative, "
        "with gentler falls than aggressive."
    )


def _top_for_sleeve(funds, asset_class: str, max_funds: int = 2, risk: str = "balanced"):
    if asset_class == "equity":
        # Tilt equity selection by risk level.
        if risk == "aggressive":
            buckets = ["Small Cap", "Mid Cap", "Flexi Cap", "Multi Cap"]
        elif risk == "conservative":
            buckets = ["Large Cap", "Index / ETF", "Flexi Cap", "Large & Mid Cap"]
        else:
            buckets = ["Flexi Cap", "Large Cap", "Large & Mid Cap", "Mid Cap"]
    else:
        buckets = SLEEVE_BUCKETS.get(asset_class, [])
    picks = []
    used_buckets = set()
    # Best fund per preferred bucket, in order, until we have max_funds.
    for b in buckets:
        candidates = [f for f in funds if f.bucket == b]
        if not candidates:
            continue
        best = max(candidates, key=lambda x: x.score)
        picks.append(best)
        used_buckets.add(b)
        if len(picks) >= max_funds:
            break
    # Fallback: any fund of this asset class.
    if not picks:
        candidates = [f for f in funds if f.asset_class == asset_class]
        if candidates:
            picks.append(max(candidates, key=lambda x: x.score))
    return picks


def derive_from_prefs(prefs: dict) -> BasketSuggestResponse:
    """Turn hexagon preferences (0-100 each) into an allocation + funds.

    Axes: returns, safety, stability, growth, diversification, liquidity.
    Higher returns/growth -> more equity (and smaller-cap tilt). Higher
    safety/stability/liquidity -> more debt/hybrid/liquid. Diversification
    controls how many sleeves/funds we spread across.
    """
    def g(k: str) -> float:
        return max(0.0, min(100.0, float(prefs.get(k, 50)))) / 100.0

    returns = g("returns")
    safety = g("safety")
    stability = g("stability")
    growth = g("growth")
    diversification = g("diversification")
    liquidity = g("liquidity")

    # Raw sleeve scores from the preferences.
    equity_score = 0.45 * returns + 0.55 * growth
    debt_score = 0.5 * safety + 0.3 * stability + 0.4 * liquidity
    hybrid_score = 0.5 * stability + 0.3 * safety + 0.2 * (1 - growth)
    gold_score = 0.25 * diversification + 0.15 * safety
    cash_score = 0.6 * liquidity  # liquid/overnight sleeve

    raw = {
        "equity": max(0.02, equity_score),
        "hybrid": max(0.0, hybrid_score),
        "debt": max(0.0, debt_score),
        "gold": max(0.0, gold_score * 0.5),
        "cash": max(0.0, cash_score * 0.4),
    }
    total = sum(raw.values()) or 1
    allocation = {k: round(v / total, 4) for k, v in raw.items()}

    funds = dashboard.all_funds()
    # Diversification decides how many funds per sleeve (1-3) + small-cap tilt.
    per_sleeve = 1 + round(diversification * 2)  # 1..3
    aggressive_tilt = growth  # 0..1, biases equity toward mid/small cap

    items: list[BasketItem] = []
    for asset_class, weight in allocation.items():
        if weight < 0.03:
            continue
        picks = _pick_for_asset(funds, asset_class, per_sleeve, aggressive_tilt)
        if not picks:
            continue
        parts = _split_weight(weight, len(picks))
        for fund, w in zip(picks, parts):
            items.append(
                BasketItem(
                    scheme_code=fund.scheme_code,
                    name=fund.name,
                    fund_house=fund.fund_house,
                    bucket=fund.bucket,
                    asset_class=fund.asset_class,
                    rating=fund.rating,
                    return_1y=fund.return_1y,
                    return_3y=fund.return_3y,
                    return_5y=fund.return_5y,
                    weight=round(w, 4),
                    sleeve=asset_class,
                    rationale=f"{fund.bucket} for the {asset_class} sleeve.",
                )
            )
    _normalize_weights(items)

    note = "Derived from your preferences: " + ", ".join(
        f"{int(v*100)}% {k}" for k, v in allocation.items() if v >= 0.03
    )
    # Report allocation without the tiny cash label merged into debt for display.
    return BasketSuggestResponse(
        risk=_risk_label(equity_score),
        allocation={k: v for k, v in allocation.items() if v >= 0.03},
        items=items,
        note=note,
    )


def _risk_label(equity_score: float) -> str:
    if equity_score >= 0.66:
        return "aggressive"
    if equity_score >= 0.4:
        return "balanced"
    return "conservative"


# Equity buckets ordered by cap tilt, used to bias by aggressiveness.
_EQUITY_BY_TILT_SAFE = ["Large Cap", "Flexi Cap", "Large & Mid Cap", "Index / ETF"]
_EQUITY_BY_TILT_AGGR = ["Small Cap", "Mid Cap", "Flexi Cap", "Multi Cap"]


def _pick_for_asset(funds, asset_class: str, n: int, aggressive: float):
    if asset_class == "cash":
        buckets = ["Liquid / Overnight"]
    elif asset_class == "equity":
        buckets = _EQUITY_BY_TILT_AGGR if aggressive >= 0.55 else _EQUITY_BY_TILT_SAFE
    else:
        buckets = SLEEVE_BUCKETS.get(asset_class, [])
    picks = []
    for b in buckets:
        cands = [f for f in funds if f.bucket == b]
        if cands:
            picks.append(max(cands, key=lambda x: x.score))
        if len(picks) >= n:
            break
    if not picks:
        cands = [f for f in funds if f.asset_class == asset_class]
        if cands:
            picks.append(max(cands, key=lambda x: x.score))
    return picks


def model_baskets() -> list[dict]:
    """Three curated, risk-tiered baskets to compare a user's basket against."""
    out = []
    meta = [
        ("conservative", "Conservative", "Capital protection with modest growth. Low volatility, shallow drawdowns."),
        ("balanced", "Balanced", "A middle path — meaningful growth with a debt cushion."),
        ("aggressive", "Aggressive", "Maximum long-term growth. Expect deep drawdowns along the way."),
    ]
    for risk, name, desc in meta:
        s = suggest(risk)
        out.append(
            {
                "key": risk,
                "name": name,
                "description": desc,
                "risk": risk,
                "allocation": s.allocation,
                "items": [i.model_dump() for i in s.items],
                "note": s.note,
            }
        )
    return out


def _split_weight(total: float, n: int) -> list[float]:
    if n == 1:
        return [total]
    if n == 2:
        return [total * 0.6, total * 0.4]
    return [total / n] * n


def _normalize_weights(items: list[BasketItem]) -> None:
    s = sum(i.weight for i in items)
    if s > 0:
        for i in items:
            i.weight = round(i.weight / s, 4)


# ---------------- persistence ----------------

def _use_supabase() -> bool:
    try:
        from app.supabase_client import get_supabase

        get_supabase()
        return True
    except Exception:
        return False


def _read_local() -> list[dict]:
    if os.path.exists(_LOCAL_PATH):
        with open(_LOCAL_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    return []


def _write_local(rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(_LOCAL_PATH), exist_ok=True)
    with open(_LOCAL_PATH, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)


def list_baskets(owner: str | None = None, goal_id: str | None = None) -> list[Basket]:
    if _use_supabase():
        from app.supabase_client import get_supabase

        q = get_supabase().table("baskets").select("*")
        if owner:
            q = q.eq("owner", owner)
        if goal_id:
            q = q.eq("goal_id", goal_id)
        rows = q.execute().data or []
    else:
        rows = _read_local()
        if owner:
            rows = [r for r in rows if r.get("owner") == owner]
        if goal_id:
            rows = [r for r in rows if r.get("goal_id") == goal_id]
    rows.sort(key=lambda r: r.get("updated_at", ""), reverse=True)
    return [Basket(**r) for r in rows]


def create_basket(payload: BasketCreate) -> Basket:
    now = datetime.now(timezone.utc).isoformat()
    row = payload.model_dump()
    row["id"] = uuid.uuid4().hex
    row["created_at"] = now
    row["updated_at"] = now
    if _use_supabase():
        from app.supabase_client import get_supabase

        get_supabase().table("baskets").insert(row).execute()
    else:
        rows = _read_local()
        rows.append(row)
        _write_local(rows)
    return Basket(**row)


def update_basket(basket_id: str, payload: BasketCreate) -> Basket | None:
    now = datetime.now(timezone.utc).isoformat()
    if _use_supabase():
        from app.supabase_client import get_supabase

        data = payload.model_dump()
        data["updated_at"] = now
        res = (
            get_supabase().table("baskets").update(data).eq("id", basket_id).execute()
        )
        rows = res.data or []
        return Basket(**rows[0]) if rows else None
    rows = _read_local()
    for r in rows:
        if r["id"] == basket_id:
            r.update(payload.model_dump())
            r["updated_at"] = now
            _write_local(rows)
            return Basket(**r)
    return None


def delete_basket(basket_id: str, owner: str | None = None) -> bool:
    if _use_supabase():
        from app.supabase_client import get_supabase

        q = get_supabase().table("baskets").delete().eq("id", basket_id)
        if owner:
            q = q.eq("owner", owner)
        q.execute()
        return True
    rows = _read_local()
    new = [
        r
        for r in rows
        if not (r["id"] == basket_id and (owner is None or r.get("owner") == owner))
    ]
    _write_local(new)
    return len(new) != len(rows)
