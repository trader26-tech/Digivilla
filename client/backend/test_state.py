#!/usr/bin/env python3
"""
TEST HELPER — put a client into a known state so you can eyeball the new client
flow (onboarding → single house filling up → grid). Talks straight to Supabase.

Usage (from client/backend, with .env present):

  python3 test_state.py show                 # print every user + their holdings
  python3 test_state.py empty  axca          # 0 villas → onboarding screen
  python3 test_state.py fill   axca 40       # 1 villa, ~40% built  → single house
  python3 test_state.py built  axca          # 1 villa, fully built → single house (earning)
  python3 test_state.py two    axca          # 2 villas             → the grid map

`axca` can be a name (case-insensitive), a phone, an owner id, or a user id.

How the numbers work (matches the app):
  • The villa is "Rental Villa" (seed_v2), ticket price ₹10,00,000.
  • "invested" = sum of PAID sip/lump_sum transactions. Build % = invested / price.
  • current_value = mark-to-market (we set it = invested here, since NAV isn't wired).
  • Monthly income shown = invested × 0.003  (₹10k invested → ₹30/mo).
  • fill 40 → invested ₹4,00,000 → 40% built, income ₹1,200/mo.
"""
import sys, uuid, datetime as dt
from dotenv import dotenv_values
from supabase import create_client

env = dotenv_values(".env")
cl = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])

VILLA = "seed_v2"            # Rental Villa, ₹10,00,000
PRICE = 1_000_000
RATE = 0.003                 # monthly income as a fraction of invested


def find_user(key: str) -> dict:
    users = cl.table("users").select("*").execute().data or []
    key_l = key.lower()
    for u in users:
        if key_l in (str(u.get("name") or "").lower(),
                     str(u.get("phone") or "").lower(),
                     str(u.get("owner") or "").lower(),
                     str(u.get("id") or "").lower()):
            return u
    # loose contains match on name/phone
    for u in users:
        if key_l in str(u.get("name") or "").lower() or key_l in str(u.get("phone") or ""):
            return u
    raise SystemExit(f"No user matched '{key}'. Run: python3 test_state.py show")


def clear_holdings(uid: str) -> None:
    hv = cl.table("user_villas").select("id").eq("user_id", uid).execute().data or []
    for h in hv:
        cl.table("transactions").delete().eq("user_villa_id", h["id"]).execute()
    cl.table("user_villas").delete().eq("user_id", uid).execute()


def add_holding(uid: str, invested: int, *, active: bool, sip: int = 10000) -> str:
    """Create one holding with `invested` recorded as a paid lump-sum txn."""
    hid = "uv_" + uuid.uuid4().hex[:8]
    today = dt.date.today()
    nxt = dt.date(today.year + (today.month // 12), (today.month % 12) + 1, 1)
    cl.table("user_villas").insert({
        "id": hid, "user_id": uid, "villa_id": VILLA,
        "status": "active" if active else "accumulating",
        "sip_monthly": 0 if active else sip,
        "sip_day": 1,
        "sip_next_payment": None if active else nxt.isoformat(),
        "current_value": invested,        # = invested until real NAV is wired
    }).execute()
    if invested > 0:
        cl.table("transactions").insert({
            "id": "t_" + uuid.uuid4().hex[:8], "user_villa_id": hid,
            "kind": "lump_sum", "amount": invested, "txn_date": today.isoformat(),
            "status": "paid", "note": "Test seed", "reference": "",
        }).execute()
    return hid


def report(u: dict) -> None:
    uid = u["id"]
    hv = cl.table("user_villas").select("*").eq("user_id", uid).execute().data or []
    n = len(hv)
    screen = ("ONBOARDING (book setup call)" if n == 0
              else "SINGLE HOUSE (filling up)" if n == 1
              else "GRID MAP")
    print(f"\n{u.get('name')}  ·  {u.get('phone')}  ·  owner={u['owner']}")
    print(f"  holdings: {n}  →  shows: {screen}")
    for h in hv:
        txns = cl.table("transactions").select("kind,amount,status")\
            .eq("user_villa_id", h["id"]).execute().data or []
        inv = sum(float(t["amount"]) for t in txns
                  if t["kind"] in ("sip", "lump_sum") and t["status"] == "paid")
        pct = round(inv / PRICE * 100)
        print(f"    - invested ₹{inv:,.0f} / ₹{PRICE:,}  = {pct}% built"
              f"  ·  income ₹{inv * RATE:,.0f}/mo  ·  status={h['status']}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__); return
    cmd = sys.argv[1]
    if cmd == "show":
        for u in cl.table("users").select("*").execute().data or []:
            report(u)
        return

    who = sys.argv[2] if len(sys.argv) > 2 else "axca"
    u = find_user(who)
    uid = u["id"]

    if cmd == "empty":
        clear_holdings(uid)
    elif cmd == "fill":
        pct = int(sys.argv[3]) if len(sys.argv) > 3 else 40
        clear_holdings(uid)
        add_holding(uid, round(PRICE * pct / 100), active=False)
    elif cmd == "built":
        clear_holdings(uid)
        add_holding(uid, PRICE, active=True)
    elif cmd == "two":
        clear_holdings(uid)
        add_holding(uid, round(PRICE * 0.4), active=False)
        add_holding(uid, PRICE, active=True)
    else:
        print(__doc__); return

    report(u)
    print("\n✓ done. In the app: pull to refresh, or reopen the PWA, to see it.")


if __name__ == "__main__":
    main()
