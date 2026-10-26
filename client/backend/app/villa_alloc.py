"""Which money sits in which villa — ONE rule, shared by the client app and the
admin (the admin image copies this file to /app/shared/villa_alloc.py).

Why this exists: villas used to be whatever the admin had pinned by hand. A
purchase nobody pinned showed up as no house at all (a ₹20 L lumpsum drew one
empty plot), and a villa's size depended on someone remembering to click. Now
the houses follow from the transactions themselves, the same way every time:

  * A villa is ₹`unit` (₹5 L today, from the calculator settings).
  * Purchases are taken in date order. Each purchase fills the OLDEST villa that
    is still open, then opens new villas; a purchase larger than the room left is
    split across villas PRO-RATA — every villa gets the same mix the purchase
    had (¼ of each fund line for a ₹20 L buy that makes four villas), so each
    villa is a real DigiVilla mix with its own units, dates and value.
  * Money taken out (redemption / SWP / switch-out) comes off the NEWEST villa
    holding that fund first, so finished villas stay finished as long as they can.
  * Anything the admin pinned by hand stays exactly where it was pinned; the
    automatic rule only places what is not pinned. Admin villa rows (name,
    status, coin) are the containers, in their sort order; when the money needs
    more villas than there are rows, the extra ones are created virtually
    (`auto:<n>`) and named by position.
  * Only funds that belong to a DigiVilla bucket (SIP or lumpsum) build villas;
    other funds count in net worth and are reported as `outside`, never hidden.
  * At most `max_houses` villas: beyond that, money folds into the last one.

Pure: no database, no clock. Both apps feed it the same rows → same houses.
"""

from __future__ import annotations

from typing import Iterable, Optional

_REDEEM_WORDS = ("redeem", "redemption", "switch out", "switch-out", "switchout", "swp", "withdraw", "sell", "stp out", "stp-out", "transfer out")


def _num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return 0.0


def txn_sign(kind) -> float:
    """+1 for money in (SIP / Lumpsum / switch-in), −1 for money out."""
    k = (kind or "").lower()
    return -1.0 if any(w in k for w in _REDEEM_WORDS) else 1.0


class _House:
    __slots__ = ("id", "name", "status", "coin", "lines", "dates", "auto", "order", "placements", "bucket", "withdrawn")

    def __init__(self, hid: str, name: str, status: str, coin: bool, auto: bool, order: int, bucket=None):
        self.id, self.name, self.status, self.coin, self.auto, self.order = hid, name, status, coin, auto, order
        self.bucket = bucket                    # the villa bucket (recipe) this house is built from; None = any
        self.lines: dict[int, dict] = {}       # scheme_code → {units, invested, scheme_name}
        self.dates: list[str] = []
        self.placements: list[dict] = []       # [{order_id, amount, units, fraction}]
        self.withdrawn = 0.0                   # ₹ taken out of this villa (SWP · redemption) — never off its invested

    def invested(self) -> float:
        return sum(l["invested"] for l in self.lines.values())

    def add(self, code: int, name: str, units: float, amount: float, day: str | None,
            order_id: str | None = None, fraction: float = 1.0) -> None:
        l = self.lines.setdefault(code, {"scheme_code": code, "scheme_name": name, "units": 0.0, "invested": 0.0})
        l["units"] += units
        l["invested"] += amount
        if not l.get("scheme_name") and name:
            l["scheme_name"] = name
        if day and amount > 0:
            self.dates.append(day)
        if order_id:
            self.placements.append({"order_id": order_id, "amount": round(amount, 2), "units": round(units, 4),
                                    "fraction": round(fraction, 6)})


def is_finished(invested: float, status, unit: float) -> bool:
    """A villa is finished at ₹unit (1% slack for the rupee rounding a lumpsum
    gets at purchase), or when the admin marked it constructed."""
    return status == "constructed" or invested >= unit * 0.99


def allocate(txns: Iterable[dict], villas: Iterable[dict], *, unit: float, max_houses: int,
             villa_codes: set, client_code: str = "", set_bucket: Optional[dict] = None,
             villa_bucket: Optional[dict] = None, exclude: Optional[set] = None) -> dict:
    """Place a client's transactions into villas.

    txns   : rows of client_transactions (order_id, scheme_code, scheme_name,
             units, amount, kind, txn_date, villa_id)
    villas : rows of client_villas (id, name, status, coin, sort_order, created_at)
    set_bucket   : {order_id: bucket_id | "outside"} — the placement decisions (auto
                   or the admin's): a purchase builds villas of ITS bucket only, so two
                   recipes never share a villa; "outside" keeps a line out of the villas.
    villa_bucket : {villa_id: bucket_id} for the admin rows.
    exclude      : order ids to treat as outside.
    Returns {houses: [...], outside: [...], placements: {order_id: [...]}, unit}.
    `houses` are in display order (finished first, then oldest first), each with
    villa_id, name, status, coin, auto, building, since, invested, pct, holdings.
    """
    unit = float(unit) if unit and unit > 0 else 500_000.0
    max_houses = int(max_houses) if max_houses and max_houses > 0 else 9

    rows = sorted(villas or [], key=lambda v: (int(v.get("sort_order") or 0), str(v.get("created_at") or ""), str(v.get("id"))))
    set_bucket = set_bucket or {}
    villa_bucket = villa_bucket or {}
    exclude = exclude or set()
    houses: list[_House] = [
        _House(str(v["id"]), v.get("name") or "Villa", v.get("status") or "building", bool(v.get("coin")), False, i,
               villa_bucket.get(str(v["id"])))
        for i, v in enumerate(rows)]
    by_id = {h.id: h for h in houses}

    def new_house(bucket=None) -> _House:
        if len(houses) >= max_houses:
            return houses[-1]                                 # the estate is full: fold into the last villa
        h = _House(f"auto:{client_code}:{len(houses) + 1}", "Villa", "building", False, True, len(houses), bucket)
        houses.append(h)
        by_id[h.id] = h
        return h

    def open_house(bucket=None) -> _House:
        """The oldest villa of this bucket that still has room (admin rows first, in order)."""
        for h in houses:
            if h.bucket == bucket and not is_finished(h.invested(), h.status, unit):
                return h
        return new_house(bucket)

    # ── 1 · normalise, split pinned / automatic / outside ──────────────────
    pinned: list[dict] = []
    auto_in: list[dict] = []
    auto_out: list[dict] = []
    outside: dict[int, dict] = {}
    for t in txns or []:
        code = t.get("scheme_code")
        if not code:
            continue
        sign = txn_sign(t.get("kind"))
        rec = {
            "order_id": str(t.get("order_id") or ""), "code": int(code), "name": t.get("scheme_name") or "Fund",
            "units": abs(_num(t.get("units"))) * sign, "amount": abs(_num(t.get("amount"))) * sign,
            "day": (str(t.get("txn_date") or "")[:10] or None), "kind": t.get("kind") or "",
        }
        vid = t.get("villa_id")
        decided = set_bucket.get(rec["order_id"])
        if vid and str(vid) in by_id:
            rec["villa_id"] = str(vid)
            pinned.append(rec)
        elif rec["order_id"] in exclude or decided == "outside":
            o = outside.setdefault(rec["code"], {"scheme_code": rec["code"], "scheme_name": rec["name"],
                                                 "units": 0.0, "invested": 0.0, "count": 0})
            o["units"] += rec["units"]
            o["invested"] += rec["amount"]
            o["count"] += 1
        elif decided or rec["code"] in villa_codes:
            rec["bucket"] = decided
            (auto_in if sign > 0 else auto_out).append(rec)
        else:
            o = outside.setdefault(rec["code"], {"scheme_code": rec["code"], "scheme_name": rec["name"],
                                                 "units": 0.0, "invested": 0.0, "count": 0})
            o["units"] += rec["units"]
            o["invested"] += rec["amount"]
            o["count"] += 1

    # ── 2 · the admin's pins, exactly as pinned ───────────────────────────
    for r in pinned:
        by_id[r["villa_id"]].add(r["code"], r["name"], r["units"], r["amount"], r["day"], r["order_id"], 1.0)

    # ── 3 · everything else, in date order: purchases fill villas; money out
    #        comes off the newest villa holding that fund ──────────────────
    def pkey(r: dict):
        return (r["day"] or "9999-99-99", r["kind"].lower(), r.get("bucket") or "")

    groups: dict[tuple, list[dict]] = {}
    for r in auto_in:
        groups.setdefault(pkey(r), []).append(r)
    events: list[tuple] = [(k[0], 0, k, lines) for k, lines in groups.items()]
    events += [((r["day"] or "9999-99-99"), 1, None, [r]) for r in auto_out]
    events.sort(key=lambda e: (e[0], e[1], str(e[2])))

    for day, kind, _k, lines in events:
        if kind == 0:                                            # a purchase (all lines of that day + kind)
            total = sum(l["amount"] for l in lines)
            if total <= 0:
                continue
            left = total
            guard = 0
            bucket = lines[0].get("bucket")
            while left > 1e-6 and guard < 1000:
                guard += 1
                h = open_house(bucket)
                room = unit - h.invested() if len(houses) < max_houses or h is not houses[-1] else float("inf")
                if h is houses[-1] and len(houses) >= max_houses:
                    room = float("inf")
                if room <= 1e-6:
                    h.status = h.status if h.status == "constructed" else h.status
                    # an admin row that is already full but not marked: it is finished by amount → open_house skips it
                    room = unit * 0.01
                take = min(room, left)
                frac = take / total
                for l in lines:
                    h.add(l["code"], l["name"], l["units"] * frac, l["amount"] * frac, l["day"], l["order_id"], frac)
                left -= take
        else:                                                    # money out
            r = lines[0]
            units_left, amt_left = -r["units"], -r["amount"]     # positive quantities to remove
            for h in sorted([h for h in houses if r["code"] in h.lines and h.lines[r["code"]]["units"] > 1e-9],
                            key=lambda h: h.order, reverse=True):
                l = h.lines[r["code"]]
                u = min(l["units"], units_left)
                if u <= 1e-9:
                    continue
                # the units come off; the invested ₹ stays (a finished villa stays finished) — the
                # sale's ₹ is this villa's withdrawal, in proportion to the units it gave
                frac = u / -r["units"] if r["units"] else 1.0
                a = amt_left * (u / units_left) if units_left > 0 else 0.0
                l["units"] -= u
                h.withdrawn += a
                if r.get("order_id"):
                    h.placements.append({"order_id": r["order_id"], "amount": -round(a, 2), "units": -round(u, 4), "fraction": -round(frac, 6)})
                units_left -= u
                amt_left -= a
                if units_left <= 1e-9:
                    break

    # ── 4 · the result, in the client's display order ─────────────────────
    out = []
    for h in houses:
        hold = [dict(l) for l in h.lines.values() if l["units"] > 1e-6 or l["invested"] > 1]
        inv = sum(l["invested"] for l in hold)
        if inv <= 0 and not hold:
            continue
        for l in hold:
            l["units"] = round(l["units"], 4)
            l["invested"] = round(l["invested"], 2)
        finished = is_finished(inv, h.status, unit)
        out.append({
            "villa_id": h.id, "name": h.name, "status": "constructed" if finished else "building",
            "coin": h.coin or finished, "auto": h.auto, "order": h.order, "bucket": h.bucket,
            "building": not finished, "since": min(h.dates) if h.dates else "",
            "invested": round(inv, 2),
            "withdrawn": round(h.withdrawn, 2),
            "pct": 100.0 if finished else round(min(99.0, inv / unit * 100), 1),
            "holdings": sorted(hold, key=lambda l: -l["invested"]),
            "placements": h.placements,
        })
    out.sort(key=lambda h: (h["building"], h["since"] or "9999", h["order"]))
    for i, h in enumerate(out):
        h["position"] = i
        if h["auto"]:
            h["name"] = f"Villa {i + 1}"
    placements: dict[str, list[dict]] = {}
    for h in out:
        for p in h["placements"]:
            placements.setdefault(p["order_id"], []).append({"villa_id": h["villa_id"], "position": h["position"],
                                                             "amount": p["amount"], "units": p["units"], "fraction": p["fraction"]})
    for h in out:
        del h["placements"]
    outside_rows = [dict(o, units=round(o["units"], 4), invested=round(o["invested"], 2))
                    for o in outside.values() if o["units"] > 1e-6 or o["invested"] > 1]
    return {"houses": out[:max_houses], "outside": outside_rows, "placements": placements, "unit": unit}
