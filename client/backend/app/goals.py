"""Goals — what the client's villas pay for, on real data.

  overview(owner)  the villas the client owns (finished / building, each with its
                   category), the payout they bring a month (villas × the estate's
                   monthly income from the calculator settings), every payout
                   actually received (money-out lines of the transaction report,
                   by month) and the client's saved goals.
  save_goals(...)  the Homecoming plan and custom goals, kept in admin_config under
                   `goals:<client code>` (no migration). The demo account is never
                   written to.
"""

from __future__ import annotations

from datetime import date, timedelta

from app import client_portfolio as cp

PAYDAY = 5
TYPES = ("conservative", "balanced", "aggressive")


def _sb():
    return cp._sb()


def _cfg(key: str) -> dict:
    try:
        rows = _sb().table("admin_config").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _estate() -> dict:
    try:
        from app import calc_config
        e = calc_config.estate()
        return {"villa_cost": float(e["villa_cost"]), "income": float(e["villa_income_monthly"])}
    except Exception:
        return {"villa_cost": 500000.0, "income": 1500.0}


def _next_payday(today: date) -> date:
    y, m = today.year, today.month
    if today.day >= PAYDAY:
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return date(y, m, PAYDAY)


def overview(owner: str) -> dict:
    code = cp.client_code_for_owner(owner)
    est = _estate()
    out = {"payday": PAYDAY, "villa_cost": est["villa_cost"], "income_per_villa": est["income"],
           "next_payday": _next_payday(date.today()).isoformat(), "client_code": code,
           "villas": [], "owned": 0, "building": 0, "by_type": {t: 0 for t in TYPES}, "untyped": 0,
           "monthly": 0.0, "payouts": [], "received": 0.0, "payout_count": 0, "goals": {}}
    if not code:
        return out
    m = cp._mapped_houses(code) or {"houses": []}
    types = _cfg("villa_types")
    villas = []
    for h in m["houses"]:
        t = types.get(str(h.get("villa_id"))) if h.get("villa_id") else None
        villas.append({"id": h.get("villa_id"), "name": h.get("name"), "building": bool(h.get("building")),
                       "invested": round(float(h.get("invested") or 0), 2), "since": h.get("since") or None,
                       "type": t if t in TYPES else None})
    finished = [v for v in villas if not v["building"]]
    out["villas"] = villas
    out["owned"] = len(finished)
    out["building"] = len(villas) - len(finished)
    for v in finished:
        if v["type"]:
            out["by_type"][v["type"]] += 1
        else:
            out["untyped"] += 1
    out["monthly"] = round(len(finished) * est["income"], 2)
    # every payout actually received: the report's money-out lines, by month
    try:
        rows = (_sb().table("client_transactions").select("txn_date,amount,kind,scheme_name")
                .eq("client_code", code).execute().data or [])
    except Exception:
        rows = []
    from app import villa_alloc
    by_month: dict[str, dict] = {}
    for r in rows:
        if villa_alloc.txn_sign(r.get("kind")) > 0:
            continue
        d = str(r.get("txn_date") or "")[:10]
        if not d:
            continue
        try:
            amt = abs(float(r.get("amount") or 0))
        except (TypeError, ValueError):
            continue
        k = d[:7]
        row = by_month.setdefault(k, {"month": k, "date": d, "amount": 0.0, "lines": 0})
        row["amount"] += amt
        row["lines"] += 1
        row["date"] = max(row["date"], d)
    payouts = sorted(by_month.values(), key=lambda r: r["month"], reverse=True)
    for p in payouts:
        p["amount"] = round(p["amount"], 2)
        # villas finished by then (first purchase on or before the payout)
        p["villas"] = sum(1 for v in finished if (v["since"] or "9999") <= p["date"])
    out["payouts"] = payouts
    out["received"] = round(sum(p["amount"] for p in payouts), 2)
    out["payout_count"] = len(payouts)
    out["goals"] = _cfg(f"goals:{code}")
    return out


def _clean_goals(body: dict) -> dict:
    """Only the shapes we know: homecoming {total, parts[4]} and custom goals."""
    out: dict = {}
    hc = body.get("homecoming") if isinstance(body, dict) else None
    if isinstance(hc, dict):
        parts = hc.get("parts")
        clean = {}
        if isinstance(parts, list) and len(parts) == 4 and all(isinstance(x, (int, float)) for x in parts):
            clean["parts"] = [max(0, min(99_999_999, round(float(x)))) for x in parts]
        if isinstance(hc.get("total"), (int, float)):
            clean["total"] = max(0, min(99_999_999, round(float(hc["total"]))))
        if hc.get("funded") is True:
            clean["funded"] = True
        if clean:
            out["homecoming"] = clean
    goals = body.get("custom") if isinstance(body, dict) else None
    if isinstance(goals, list):
        keep = []
        for g in goals[:50]:
            if not isinstance(g, dict):
                continue
            keep.append({
                "id": str(g.get("id") or "")[:40], "kind": str(g.get("kind") or "other")[:20], "name": str(g.get("name") or "")[:40],
                "amount": max(0, min(99_999_999, round(float(g.get("amount") or 0)))),
                "type": int(g.get("type") or 0) if str(g.get("type")) in ("0", "1", "2") else 0,
                "m": int(g.get("m") or 0), "villas": max(0, int(g.get("villas") or 0)),
                "created": str(g.get("created") or "")[:32],
            })
        out["custom"] = keep
    return out


def save_goals(owner: str, body: dict) -> dict:
    code = cp.client_code_for_owner(owner)
    clean = _clean_goals(body or {})
    if not code:
        return clean
    try:
        cl = _sb()
        cl.table("admin_config").delete().eq("key", f"goals:{code}").execute()
        cl.table("admin_config").insert({"key": f"goals:{code}", "value": clean}).execute()
    except Exception:
        pass
    return clean
