"""Client CRM — the admin's full view of a person.

A "client" is a user of the app. This service assembles, for each client, their
contact details, the villas they own or are building, their money (SIP + rent +
the transaction ledger) and their calendar requests — everything the admin needs
on one screen when they open a client.

Data comes from the shared Supabase tables created in
client/backend/migrations/003_digivilla.sql:
    users · user_villas · villas · transactions · bookings

Documents stay in the existing per-client document vault (see documents.py),
looked up by the client's name so nothing there has to change.

Falls back to a bundled sample dataset (the seed rows) when Supabase isn't
configured or the tables don't exist yet, so the Clients tab is testable with
zero setup — mirroring the dual-store pattern used across the admin backend.
"""

from __future__ import annotations

from app import documents as documents_svc

# ── which storage to use ─────────────────────────────────────────────────────
_TABLE_OK = None  # None = unprobed


def _use_supabase() -> bool:
    """True only when Supabase is configured AND the users table exists."""
    global _TABLE_OK
    if _TABLE_OK is not None:
        return _TABLE_OK
    try:
        from app.supabase_client import get_supabase

        get_supabase().table("users").select("id").limit(1).execute()
        _TABLE_OK = True
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in ("users", "does not exist", "pgrst205",
                                  "schema cache", "could not find", "not configured")):
            _TABLE_OK = False
        else:
            return False
    return _TABLE_OK


def _rows(table: str) -> list[dict]:
    """All rows of a table from Supabase, or the sample fallback."""
    if _use_supabase():
        try:
            from app.supabase_client import get_supabase

            return get_supabase().table(table).select("*").execute().data or []
        except Exception:
            return []
    return list(_SAMPLE.get(table, []))


# Forward monthly income as a fraction of invested (0.3%/mo ≈ 3.6%/yr):
# ₹1cr invested → ₹30k/mo, ₹10k → ₹30. Same rate the client app uses.
MONTHLY_INCOME_RATE = 0.003


# ── money helpers ─────────────────────────────────────────────────────────────
def _money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _invested(txns: list[dict]) -> float:
    return sum(_money(t.get("amount")) for t in txns
               if t.get("kind") in ("sip", "lump_sum") and t.get("status") == "paid")


def _rent_received(txns: list[dict]) -> float:
    return sum(_money(t.get("amount")) for t in txns
               if t.get("kind") == "rent" and t.get("status") != "skipped")


# ── public API ────────────────────────────────────────────────────────────────
def list_clients() -> list[dict]:
    """Every client, newest first-ish, with a light summary for the list view:
    name, phone, how many villas, total invested, whether anything needs action."""
    users = _rows("users")
    user_villas = _rows("user_villas")
    txns = _rows("transactions")
    bookings = _rows("bookings")

    uv_by_user: dict[str, list[dict]] = {}
    for uv in user_villas:
        uv_by_user.setdefault(uv.get("user_id"), []).append(uv)
    txn_by_uv: dict[str, list[dict]] = {}
    for t in txns:
        txn_by_uv.setdefault(t.get("user_villa_id"), []).append(t)
    pending_by_user: dict[str, int] = {}
    for b in bookings:
        if b.get("status") == "requested" and b.get("user_id"):
            pending_by_user[b["user_id"]] = pending_by_user.get(b["user_id"], 0) + 1

    out = []
    for u in users:
        uid = u.get("id")
        villas = uv_by_user.get(uid, [])
        invested = sum(_invested(txn_by_uv.get(uv.get("id"), [])) for uv in villas)
        out.append({
            "id": uid,
            "name": u.get("name") or "Unnamed",
            "phone": u.get("phone") or "",
            "city": u.get("city") or "",
            "villa_count": len(villas),
            "invested": invested,
            "pending": pending_by_user.get(uid, 0),
        })
    out.sort(key=lambda c: (c["name"] or "").lower())
    return out


def get_client(user_id: str) -> dict | None:
    """The full profile for one client: contact, villas, money, ledger, requests,
    documents. Returns None if the user isn't found."""
    user = next((u for u in _rows("users") if u.get("id") == user_id), None)
    if not user:
        return None

    villas_by_id = {v.get("id"): v for v in _rows("villas")}
    my_uv = [uv for uv in _rows("user_villas") if uv.get("user_id") == user_id]
    all_txns = _rows("transactions")
    txn_by_uv: dict[str, list[dict]] = {}
    for t in all_txns:
        txn_by_uv.setdefault(t.get("user_villa_id"), []).append(t)
    # fund concentration per villa (which funds each villa is made of)
    funds_by_villa: dict[str, list[dict]] = {}
    for f in _rows("villa_funds"):
        funds_by_villa.setdefault(f.get("villa_id"), []).append(f)

    holdings = []
    total_invested = total_value = total_rent = total_sip = total_income = 0.0
    ledger: list[dict] = []
    for uv in my_uv:
        villa = villas_by_id.get(uv.get("villa_id"), {})
        txns = sorted(txn_by_uv.get(uv.get("id"), []),
                      key=lambda t: t.get("txn_date", ""), reverse=True)
        invested = _invested(txns)
        rent = _rent_received(txns)
        price = _money(villa.get("price"))
        value = _money(uv.get("current_value"))
        sip = _money(uv.get("sip_monthly"))
        # forward monthly income: proportional to what's actually invested
        # (0.3%/mo ≈ 3.6%/yr) — even a villa still under SIP earns a little.
        income = 0.0 if uv.get("status") == "exited" else round(invested * MONTHLY_INCOME_RATE)
        total_invested += invested
        total_value += value
        total_rent += rent
        total_sip += sip
        total_income += income
        # fund concentration: weight → this client's ₹ in each fund (by current value)
        vfunds = sorted(funds_by_villa.get(uv.get("villa_id"), []),
                        key=lambda f: (f.get("sort_order", 0), -_money(f.get("weight"))))
        funds = [{
            "fund_name": f.get("fund_name") or "Fund",
            "scheme_code": f.get("scheme_code"),
            "weight": _money(f.get("weight")),
            "role": f.get("role") or "growth",
            "value": round(value * _money(f.get("weight"))),
            "withdraw_monthly": _money(f.get("withdraw_monthly")),
        } for f in vfunds]
        holdings.append({
            "id": uv.get("id"),
            "villa_name": villa.get("name") or "Villa",
            "villa_id": uv.get("villa_id"),
            "status": uv.get("status") or "accumulating",
            "price": price,
            "invested": invested,
            "progress": round(invested / price, 4) if price else None,
            "current_value": value,
            "rent_received": rent,
            "monthly_income": income,
            "sip_monthly": sip,
            "sip_next_payment": uv.get("sip_next_payment"),
            "funds": funds,
        })
        for t in txns:
            ledger.append({
                "id": t.get("id"),
                "villa_name": villa.get("name") or "Villa",
                "kind": t.get("kind"),
                "amount": _money(t.get("amount")),
                "date": t.get("txn_date"),
                "status": t.get("status"),
                "note": t.get("note") or "",
            })
    ledger.sort(key=lambda t: t.get("date") or "", reverse=True)

    requests = [b for b in _rows("bookings") if b.get("user_id") == user_id]
    requests.sort(key=lambda b: b.get("created_at") or "", reverse=True)

    # documents are looked up by the client's name (existing vault)
    try:
        docs = documents_svc.list_documents(user.get("name") or "")
    except Exception:
        docs = []

    return {
        "id": user_id,
        "name": user.get("name") or "Unnamed",
        "phone": user.get("phone") or "",
        "email": user.get("email") or "",
        "city": user.get("city") or "",
        "age": user.get("age"),
        "summary": {
            "invested": total_invested,
            "current_value": total_value,
            "rent_received": total_rent,
            "monthly_income": total_income,
            "sip_monthly": total_sip,
            "villa_count": len(holdings),
        },
        "holdings": holdings,
        "ledger": ledger,
        "requests": requests,
        "documents": docs,
    }


# ── sample fallback (mirrors 003_digivilla_seed.sql) ─────────────────────────
_SAMPLE = {
    "users": [
        {"id": "u_ravi", "phone": "9876543210", "email": "ravi@mail.com",
         "name": "Ravi Kumar", "age": 34, "city": "Chennai"},
        {"id": "u_anjali", "phone": "9000011111", "email": "anjali@mail.com",
         "name": "Anjali Menon", "age": 41, "city": "Kochi"},
    ],
    "villas": [
        {"id": "v_1l", "name": "Starter Villa", "price": 100000, "rent_monthly": 0},
        {"id": "v_10l", "name": "Estate Villa", "price": 1000000, "rent_monthly": 5000},
        {"id": "v_50l", "name": "Manor Villa", "price": 5000000, "rent_monthly": 27000},
    ],
    "villa_funds": [
        {"id": "vf_01", "villa_id": "v_1l", "scheme_code": 122640, "fund_name": "Parag Parikh Flexi Cap", "weight": 0.45, "role": "growth", "withdraw_monthly": 0, "sort_order": 1},
        {"id": "vf_02", "villa_id": "v_1l", "scheme_code": 100119, "fund_name": "HDFC Balanced Advantage", "weight": 0.30, "role": "hedge", "withdraw_monthly": 0, "sort_order": 2},
        {"id": "vf_03", "villa_id": "v_1l", "scheme_code": 105758, "fund_name": "HDFC Mid-Cap Opportunities", "weight": 0.25, "role": "growth", "withdraw_monthly": 0, "sort_order": 3},
        {"id": "vf_04", "villa_id": "v_10l", "scheme_code": 105968, "fund_name": "Kotak Equity Arbitrage", "weight": 0.40, "role": "income", "withdraw_monthly": 5000, "sort_order": 1},
        {"id": "vf_05", "villa_id": "v_10l", "scheme_code": 103340, "fund_name": "ICICI Pru Liquid", "weight": 0.10, "role": "liquid", "withdraw_monthly": 0, "sort_order": 2},
        {"id": "vf_06", "villa_id": "v_10l", "scheme_code": 122640, "fund_name": "Parag Parikh Flexi Cap", "weight": 0.50, "role": "growth", "withdraw_monthly": 0, "sort_order": 3},
    ],
    "user_villas": [
        {"id": "uv_1", "user_id": "u_ravi", "villa_id": "v_1l", "status": "accumulating",
         "sip_monthly": 10000, "sip_day": 5, "sip_next_payment": "2026-10-05",
         "current_value": 62400},
        {"id": "uv_2", "user_id": "u_anjali", "villa_id": "v_10l", "status": "active",
         "sip_monthly": 0, "sip_day": None, "sip_next_payment": None,
         "current_value": 1048000},
        # Anjali also builds a second villa by SIP → shows the multi-villa case
        {"id": "uv_3", "user_id": "u_anjali", "villa_id": "v_1l", "status": "accumulating",
         "sip_monthly": 5000, "sip_day": 1, "sip_next_payment": "2026-10-01",
         "current_value": 21500},
    ],
    "transactions": [
        {"id": "t_1", "user_villa_id": "uv_1", "kind": "sip", "amount": 10000, "txn_date": "2026-07-05", "status": "paid", "note": ""},
        {"id": "t_2", "user_villa_id": "uv_1", "kind": "sip", "amount": 10000, "txn_date": "2026-08-05", "status": "paid", "note": ""},
        {"id": "t_3", "user_villa_id": "uv_1", "kind": "sip", "amount": 10000, "txn_date": "2026-09-05", "status": "paid", "note": ""},
        {"id": "t_4", "user_villa_id": "uv_1", "kind": "lump_sum", "amount": 30000, "txn_date": "2026-08-20", "status": "paid", "note": "Diwali bonus"},
        {"id": "t_5", "user_villa_id": "uv_2", "kind": "lump_sum", "amount": 1000000, "txn_date": "2026-06-10", "status": "paid", "note": ""},
        {"id": "t_6", "user_villa_id": "uv_2", "kind": "rent", "amount": 5000, "txn_date": "2026-07-01", "status": "paid", "note": ""},
        {"id": "t_7", "user_villa_id": "uv_2", "kind": "rent", "amount": 5000, "txn_date": "2026-08-01", "status": "paid", "note": ""},
        {"id": "t_8", "user_villa_id": "uv_2", "kind": "rent", "amount": 4500, "txn_date": "2026-09-01", "status": "reduced", "note": "arbitrage sleeve low"},
        {"id": "t_9", "user_villa_id": "uv_2", "kind": "withdrawal", "amount": 0, "txn_date": "2026-09-04", "status": "pending", "note": "requested Rs 3.5L"},
        {"id": "t_10", "user_villa_id": "uv_3", "kind": "sip", "amount": 5000, "txn_date": "2026-08-01", "status": "paid", "note": ""},
        {"id": "t_11", "user_villa_id": "uv_3", "kind": "sip", "amount": 5000, "txn_date": "2026-09-01", "status": "paid", "note": ""},
        {"id": "t_12", "user_villa_id": "uv_3", "kind": "lump_sum", "amount": 10000, "txn_date": "2026-08-15", "status": "paid", "note": "top-up"},
    ],
    "bookings": [
        {"id": "b_1", "user_id": "u_ravi", "villa_id": "v_1l", "name": "Ravi Kumar", "phone": "9876543210", "kind": "sip", "amount": 10000, "slot": "", "status": "requested", "created_at": "2026-09-05"},
        {"id": "b_2", "user_id": "u_anjali", "villa_id": "v_10l", "name": "Anjali Menon", "phone": "9000011111", "kind": "withdraw", "amount": 350000, "slot": "", "status": "requested", "created_at": "2026-09-04"},
        {"id": "b_3", "user_id": "u_anjali", "villa_id": "v_50l", "name": "Anjali Menon", "phone": "9000011111", "kind": "consultation", "amount": 0, "slot": "2026-09-08T10:30", "status": "confirmed", "created_at": "2026-09-02"},
    ],
}


def seed_sample() -> dict:
    """Insert the sample clients (Ravi + Anjali) into Supabase so the Clients
    tab has data to show. Idempotent: upserts by primary key, so re-running is
    safe. No-op (with a message) when Supabase isn't configured. Order matters —
    parents (users, villas) before children (user_villas, transactions)."""
    if not _use_supabase():
        return {"ok": False, "detail": "Supabase not configured; the app already shows the built-in samples."}
    from app.supabase_client import get_supabase

    cl = get_supabase()
    counts: dict[str, int] = {}
    order = ["users", "villas", "villa_funds", "user_villas", "transactions", "bookings"]
    for table in order:
        rows = _SAMPLE.get(table, [])
        if not rows:
            continue
        try:
            cl.table(table).upsert(rows).execute()
            counts[table] = len(rows)
        except Exception as e:
            return {"ok": False, "detail": f"Failed seeding {table}: {e}", "done": counts}
    return {"ok": True, "seeded": counts}


def add_second_villa() -> dict:
    """Give an existing client a SECOND villa (a different one from what they
    already hold), plus a small SIP + a couple of contributions, so the Clients
    tab has a real multi-villa example. Idempotent-ish: skips clients who already
    hold 2+ villas. Works on the live Supabase data."""
    if not _use_supabase():
        return {"ok": False, "detail": "Supabase not configured."}
    import uuid
    from datetime import date
    from app.supabase_client import get_supabase

    cl = get_supabase()
    users = _rows("users")
    villas = _rows("villas")
    user_villas = _rows("user_villas")
    if not users or len(villas) < 2:
        return {"ok": False, "detail": "Need at least one client and two villas in the catalogue."}

    held: dict[str, list[str]] = {}
    for uv in user_villas:
        held.setdefault(uv.get("user_id"), []).append(uv.get("villa_id"))

    # pick the first client who currently holds exactly one villa
    target = next((u for u in users if len(held.get(u.get("id"), [])) == 1), None)
    if not target:
        # everyone already has 2+ (or none) — nothing to do
        already = next((u for u in users if len(held.get(u.get("id"), [])) >= 2), None)
        if already:
            return {"ok": True, "detail": f"{already.get('name')} already has 2+ villas.", "user_id": already.get("id")}
        return {"ok": False, "detail": "No client with exactly one villa to extend."}

    uid = target["id"]
    have = set(held.get(uid, []))
    # choose a different villa (prefer the cheapest one they don't have)
    other = next((v for v in sorted(villas, key=lambda v: _money(v.get("price")))
                  if v.get("id") not in have), None)
    if not other:
        return {"ok": False, "detail": "No alternative villa to add."}

    uv_id = "uv_" + uuid.uuid4().hex[:8]
    price = _money(other.get("price"))
    invested = round(price * 0.2)  # 20% in so far → accumulating
    try:
        cl.table("user_villas").insert({
            "id": uv_id, "user_id": uid, "villa_id": other["id"], "status": "accumulating",
            "sip_monthly": 5000, "sip_day": 1, "sip_next_payment": "2026-10-01",
            "current_value": round(invested * 1.05),
        }).execute()
        cl.table("transactions").insert([
            {"id": "t_" + uuid.uuid4().hex[:8], "user_villa_id": uv_id, "kind": "sip",
             "amount": 5000, "txn_date": "2026-08-01", "status": "paid", "note": ""},
            {"id": "t_" + uuid.uuid4().hex[:8], "user_villa_id": uv_id, "kind": "sip",
             "amount": 5000, "txn_date": "2026-09-01", "status": "paid", "note": ""},
            {"id": "t_" + uuid.uuid4().hex[:8], "user_villa_id": uv_id, "kind": "lump_sum",
             "amount": max(invested - 10000, 0), "txn_date": "2026-08-15", "status": "paid", "note": "top-up"},
        ]).execute()
    except Exception as e:
        return {"ok": False, "detail": f"Failed adding second villa: {e}"}

    return {"ok": True, "user_id": uid, "name": target.get("name"),
            "added_villa": other.get("name"), "detail": f"{target.get('name')} now holds 2 villas."}


# ── villa management (map villas to a client) ────────────────────────────────
def list_villas() -> list[dict]:
    """The villa catalogue — every villa the admin can assign to a client."""
    villas = _rows("villas")
    out = []
    for v in sorted(villas, key=lambda v: (v.get("sort_order", 0), _money(v.get("price")))):
        out.append({
            "id": v.get("id"),
            "name": v.get("name") or "Villa",
            "price": _money(v.get("price")),
            "rent_monthly": _money(v.get("rent_monthly")),
            "target_growth": _money(v.get("target_growth")),
        })
    return out


def add_holding(user_id: str, villa_id: str, sip_monthly: float = 0,
                invested: float = 0, status: str = "accumulating") -> dict:
    """Assign a villa to a client (a new user_villas row), optionally seeding an
    initial invested amount as a lump-sum transaction. Returns the updated profile."""
    if not _use_supabase():
        return {"ok": False, "detail": "Supabase not configured."}
    import uuid
    from datetime import date
    from app.supabase_client import get_supabase
    cl = get_supabase()

    if not next((u for u in _rows("users") if u.get("id") == user_id), None):
        return {"ok": False, "detail": "Client not found."}
    villa = next((v for v in _rows("villas") if v.get("id") == villa_id), None)
    if not villa:
        return {"ok": False, "detail": "Villa not found."}

    uv_id = "uv_" + uuid.uuid4().hex[:8]
    invested = max(0.0, _money(invested))
    sip = max(0.0, _money(sip_monthly))
    # Seed the money that's actually in: a lump-sum if given, plus the first SIP
    # instalment if a SIP was set — so "Invested" reflects the SIP right away
    # (a SIP with no instalment recorded looked like ₹0 invested).
    seed_txns = []
    if invested > 0:
        seed_txns.append(("lump_sum", invested, "Initial allocation"))
    if sip > 0:
        seed_txns.append(("sip", sip, "First SIP instalment"))
    invested_total = invested + (sip if sip > 0 else 0)
    row = {
        "id": uv_id, "user_id": user_id, "villa_id": villa_id,
        "status": status if status in ("accumulating", "active", "exited") else "accumulating",
        "sip_monthly": sip, "sip_day": 1,
        "current_value": round(invested_total),
    }
    try:
        cl.table("user_villas").insert(row).execute()
        if seed_txns:
            cl.table("transactions").insert([
                {"id": "t_" + uuid.uuid4().hex[:8], "user_villa_id": uv_id,
                 "kind": k, "amount": amt, "txn_date": date.today().isoformat(),
                 "status": "paid", "note": note}
                for (k, amt, note) in seed_txns
            ]).execute()
    except Exception as e:
        return {"ok": False, "detail": f"Could not add villa: {e}"}
    return {"ok": True, "detail": f"Added {villa.get('name')}.", "profile": get_client(user_id)}


def update_holding(user_id: str, uv_id: str, patch: dict) -> dict:
    """Modify a client's villa holding — SIP, status, or current value."""
    if not _use_supabase():
        return {"ok": False, "detail": "Supabase not configured."}
    from app.supabase_client import get_supabase
    cl = get_supabase()

    fields: dict = {}
    if "sip_monthly" in patch and patch["sip_monthly"] is not None:
        fields["sip_monthly"] = max(0.0, _money(patch["sip_monthly"]))
    if "current_value" in patch and patch["current_value"] is not None:
        fields["current_value"] = max(0.0, _money(patch["current_value"]))
    if patch.get("status") in ("accumulating", "active", "exited"):
        fields["status"] = patch["status"]
    if not fields:
        return {"ok": False, "detail": "Nothing to update."}
    try:
        res = cl.table("user_villas").update(fields).eq("id", uv_id).eq("user_id", user_id).execute()
        if not (res.data or []):
            return {"ok": False, "detail": "Holding not found."}
    except Exception as e:
        return {"ok": False, "detail": f"Could not update: {e}"}
    return {"ok": True, "detail": "Updated.", "profile": get_client(user_id)}


def delete_holding(user_id: str, uv_id: str) -> dict:
    """Remove a villa from a client (and its ledger rows)."""
    if not _use_supabase():
        return {"ok": False, "detail": "Supabase not configured."}
    from app.supabase_client import get_supabase
    cl = get_supabase()
    try:
        cl.table("transactions").delete().eq("user_villa_id", uv_id).execute()
        cl.table("user_villas").delete().eq("id", uv_id).eq("user_id", user_id).execute()
    except Exception as e:
        return {"ok": False, "detail": f"Could not remove: {e}"}
    return {"ok": True, "detail": "Removed.", "profile": get_client(user_id)}
