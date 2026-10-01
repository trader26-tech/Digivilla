"""Seed the public demo account ("Explore the demo" on the login screen).

The demo user is the developer test phone +91 99999 99999, whose CRM record is
client_code DEV9999. This gives it a believable estate that exercises every
feature — two finished villas bought at different times (so they show different
values) and a plot still being built by a monthly SIP — priced at the REAL NAV of
each purchase date, exactly as the AMC's report would.

Re-runnable: it replaces the demo's villas, transactions and holdings each time
(order ids DEMO-…; nothing of any real client is read or written).

    cd client/backend && .venv/bin/python scripts/seed_demo.py
"""

from __future__ import annotations

import json
import sys
import urllib.request
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.calculators import villa_mix  # noqa: E402
from app.client_portfolio import _sb  # noqa: E402

DEMO_CODE = "DEV9999"
DEMO_PHONE = "+919999999999"

# (villa name, status, payout coin, purchases [(date, kind, ₹)])
PLAN = [
    ("Villa 1", "constructed", True, [("2023-04-12", "Lumpsum", 5_00_000)]),
    ("Villa 2", "constructed", True, [("2024-11-20", "Lumpsum", 5_00_000)]),
    ("Villa 3", "building", False,
     [(f"{y}-{m:02d}-05", "SIP", 25_000) for y, m in
      [(2025, 11), (2025, 12), (2026, 1), (2026, 2), (2026, 3), (2026, 4),
       (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)]]),
]

_hist: dict[int, list[tuple[str, float]]] = {}


def nav_on(code: int, day: str) -> tuple[float, str]:
    """The NAV a purchase on `day` gets: that day's, or the last one before it."""
    if code not in _hist:
        with urllib.request.urlopen(f"https://api.mfapi.in/mf/{code}", timeout=30) as r:
            rows = []
            for p in json.load(r).get("data") or []:
                dd, mm, yy = p["date"].split("-")
                rows.append((f"{yy}-{mm}-{dd}", float(p["nav"])))
        _hist[code] = sorted(rows)
    best = None
    for d, nav in _hist[code]:
        if d <= day:
            best = (nav, d)
        else:
            break
    if not best:
        raise SystemExit(f"no NAV for {code} on or before {day}")
    return best


def main() -> None:
    sb = _sb()
    mix = villa_mix()
    tot = sum(float(f["allocation"]) for f in mix)
    now = datetime.now(timezone.utc).isoformat()
    today = date.today().isoformat()

    # the CRM record + the app user (clearly sample data)
    sb.table("client_master").upsert({
        "client_code": DEMO_CODE, "name": "Demo Investor", "phone": "9999999999",
        "pan": "ABCDE1234F", "email": "demo@digivilla.app", "dob": "01/01/1990",
        "address": "Sample address — this is a demo account", "city": "Chennai",
        "state": "TN", "pin": "600001", "updated_at": now,
    }, on_conflict="client_code").execute()
    users = sb.table("users").select("owner,phone").execute().data or []
    for u in users:
        if (u.get("phone") or "").replace(" ", "")[-10:] == "9999999999":
            sb.table("users").update({"name": "Demo", "estate_name": "Demo",
                                      "estate_city": "Chennai"}).eq("owner", u["owner"]).execute()

    # wipe the demo's previous sample (never anyone else's)
    sb.table("client_transactions").delete().eq("client_code", DEMO_CODE).execute()
    sb.table("client_villas").delete().eq("client_code", DEMO_CODE).execute()
    sb.table("client_holdings").delete().eq("client_code", DEMO_CODE).execute()

    txns, holdings = [], {}
    for order, (name, status, coin, buys) in enumerate(PLAN):
        vid = str(uuid.uuid4())
        sb.table("client_villas").insert({
            "id": vid, "client_code": DEMO_CODE, "name": name, "status": status,
            "coin": coin, "sort_order": order, "created_at": now, "updated_at": now,
        }).execute()
        for day, kind, amount in buys:
            for f in mix:
                code = int(f["scheme_code"])
                amt = round(amount * float(f["allocation"]) / tot, 2)
                nav, _ = nav_on(code, day)
                units = round(amt / nav, 4)
                txns.append({
                    "order_id": f"DEMO-{uuid.uuid4().hex[:12].upper()}", "client_code": DEMO_CODE,
                    "txn_date": day, "scheme_name": f["name"], "scheme_code": code, "folio_no": "DEMO",
                    "kind": kind, "amount": amt, "nav": nav, "units": units, "villa_id": vid,
                    "report_date": today, "updated_at": now,
                })
                h = holdings.setdefault(code, {"scheme_name": f["name"], "units": 0.0, "invested": 0.0, "nav": nav})
                h["units"] += units
                h["invested"] += amt
                h["nav"] = nav
    sb.table("client_transactions").insert(txns).execute()
    sb.table("client_holdings").insert([{
        "client_code": DEMO_CODE, "scheme_name": h["scheme_name"], "scheme_code": code, "folio_no": "DEMO",
        "units": round(h["units"], 4), "invested": round(h["invested"], 2), "last_nav": h["nav"],
        "report_date": today, "updated_at": now,
    } for code, h in holdings.items()]).execute()

    inv = sum(h["invested"] for h in holdings.values())
    print(f"demo seeded: {len(PLAN)} villas, {len(txns)} transactions, {len(holdings)} funds, ₹{inv:,.0f} invested")


if __name__ == "__main__":
    main()
