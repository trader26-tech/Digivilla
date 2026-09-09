"""Daily reports → client net worth & villa live pricing.

Each day the admin uploads two reports:
  • User Report (.xlsx)         — the client master (code, PAN, contact…).
  • Transaction Report (.csv)   — every SIP/purchase line (units, amount, NAV).

We keep the raw file as PROOF (Supabase Storage bucket `admin-reports`) and the
parsed rows in tables. ONE report per type per day — re-uploading replaces that
day's file and re-parses. The two reports join on client code
(User."Code" == Transaction."Client Code").

From the joined data we compute, per client:
  • net worth   = Σ (units × live REGULAR-plan NAV) across all holdings
  • invested    = Σ amount
  • gain        = net worth − invested
  • villas owned: holdings matched into admin-defined villa "buckets"
  • extra: holdings not in any bucket

Live NAV comes from mfapi.in, REGULAR plan (not Direct), resolved once per raw
scheme name and cached.

Dual-store: Supabase when configured, else local JSON/disk (mirrors documents.py).
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import uuid
from datetime import datetime, timezone

import httpx

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_FILES_DIR = os.path.join(_DATA_DIR, "report_files")
_STORE_JSON = os.path.join(_DATA_DIR, "reports_store.json")

_BUCKET = "admin-reports"
_PROBE_TABLE = "report_uploads"

MFAPI = "https://api.mfapi.in"


# ── dual-store probe (same pattern as documents.py) ──────────────────────────
_TABLE_OK = None


def _use_supabase() -> bool:
    global _TABLE_OK
    if _TABLE_OK is not None:
        return _TABLE_OK
    try:
        from app.supabase_client import get_supabase
        get_supabase().table(_PROBE_TABLE).select("id").limit(1).execute()
        _TABLE_OK = True
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in (_PROBE_TABLE, "does not exist", "pgrst205",
                                  "schema cache", "could not find", "not configured")):
            _TABLE_OK = False
        else:
            return False
    return _TABLE_OK


def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── local JSON store (fallback) ──────────────────────────────────────────────
def _load_local() -> dict:
    try:
        with open(_STORE_JSON, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"uploads": [], "clients": {}, "holdings": [], "buckets": [],
                "bucket_funds": [], "nav_cache": {}, "code_map": {}}


def _save_local(store: dict) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = _STORE_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _STORE_JSON)


# ============================================================================
# PARSING
# ============================================================================
def _to_float(v) -> float:
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return 0.0


def parse_transaction_csv(content: bytes) -> tuple[list[dict], str | None]:
    """Return (holdings-aggregated rows, report_date). Aggregates by
    (client_code, scheme_name, folio) → total units + invested + last NAV."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    agg: dict[tuple, dict] = {}
    report_date = None
    for row in reader:
        code = (row.get("Client Code") or "").strip()
        scheme = (row.get("Scheme Name") or "").strip()
        folio = (row.get("Folio No") or "").strip()
        if not code or not scheme:
            continue
        units = _to_float(row.get("Units"))
        amount = _to_float(row.get("Amount"))
        nav = _to_float(row.get("NAV"))
        d = (row.get("NAV Date") or "").strip()
        if d and not report_date:
            report_date = _norm_date(d)
        key = (code, scheme, folio)
        e = agg.setdefault(key, {
            "client_code": code, "client_name": (row.get("Client") or "").strip(),
            "scheme_name": scheme, "folio_no": folio,
            "units": 0.0, "invested": 0.0, "last_nav": nav,
        })
        e["units"] += units
        e["invested"] += amount
        if nav:
            e["last_nav"] = nav
    rows = list(agg.values())
    return rows, report_date


def parse_user_report(content: bytes, filename: str) -> list[dict]:
    """Parse the User Report — .xlsx (preferred) or .csv. Returns client dicts."""
    name = (filename or "").lower()
    if name.endswith(".csv"):
        return _parse_user_csv(content)
    return _parse_user_xlsx(content)


_USER_FIELDS = ["signup", "client_code", "name", "pan", "phone", "email",
                "dob", "address", "city", "state", "pin"]


def _e164(phone: str) -> str:
    """Store phones in E.164 so they join the client app's phone logins, which
    normalize to +91… . A bare 10-digit Indian number → +91XXXXXXXXXX; anything
    already prefixed or non-standard is left as-is."""
    import re
    p = (phone or "").strip()
    if not p:
        return ""
    if p.startswith("+"):
        return p
    digits = re.sub(r"\D", "", p)
    return "+91" + digits if len(digits) == 10 else p


def _row_to_client(cells: list) -> dict | None:
    vals = [("" if c is None else str(c).strip()) for c in cells]
    vals += [""] * (len(_USER_FIELDS) - len(vals))
    d = dict(zip(_USER_FIELDS, vals))
    if not d.get("client_code"):
        return None
    if "phone" in d:
        d["phone"] = _e164(d.get("phone"))
    return d


def _parse_user_xlsx(content: bytes) -> list[dict]:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    ws = wb.worksheets[0]
    out: list[dict] = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue  # header
        c = _row_to_client(list(row))
        if c:
            out.append(c)
    return out


def _parse_user_csv(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    out: list[dict] = []
    for i, row in enumerate(reader):
        if i == 0:
            continue
        c = _row_to_client(row)
        if c:
            out.append(c)
    return out


def _norm_date(d: str) -> str:
    """DD/MM/YYYY → YYYY-MM-DD; pass through ISO."""
    d = (d or "").strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", d)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return d[:10]


# ============================================================================
# SCHEME → REGULAR-PLAN CODE (mfapi.in)  + LIVE NAV
# ============================================================================
def _norm_scheme(name: str) -> str:
    s = (name or "").lower()
    s = re.sub(r"\b(growth|regular|plan|option|fund|the)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _search_regular_code(raw_name: str) -> tuple[int | None, str | None]:
    """Resolve a raw scheme name to its mfapi.in REGULAR-plan Growth code."""
    core = re.sub(r"\s*-?\s*(growth|direct|regular|plan|option)\b.*$", "", raw_name, flags=re.I).strip()
    q = core or raw_name
    try:
        r = httpx.get(f"{MFAPI}/mf/search", params={"q": q}, timeout=12)
        results = r.json()
    except Exception:
        return None, None

    want = set(_norm_scheme(raw_name).split())

    def score(item) -> float:
        n = item.get("schemeName", "")
        nl = n.lower()
        if "direct" in nl:
            return -100
        s = 0.0
        if "regular" in nl:
            s += 5
        if "growth" in nl:
            s += 4
        if any(bad in nl for bad in ("idcw", "dividend", "payout", "reinvest", "bonus")):
            s -= 6
        have = set(_norm_scheme(n).split())
        # reward shared tokens, but PENALISE extra tokens the raw name lacks
        # (so "Mid Cap" beats "Large & Mid Cap" for an "…Mid Cap Fund" holding).
        s += 2 * len(want & have)
        s -= 1.5 * len(have - want)
        s -= 0.5 * len(want - have)
        return s

    best = None
    best_s = -1
    for it in results or []:
        sc = score(it)
        if sc > best_s:
            best_s, best = sc, it
    if not best or best_s < 0:
        return None, None
    return int(best["schemeCode"]), best.get("schemeName")


def resolve_scheme_code(raw_name: str) -> int | None:
    """Cached resolve: raw scheme name → regular-plan code."""
    key = _norm_scheme(raw_name)
    if _use_supabase():
        try:
            r = _sb().table("scheme_code_map").select("scheme_code").eq("raw_name", key).limit(1).execute()
            if r.data:
                return r.data[0].get("scheme_code")
        except Exception:
            pass
        code, resolved = _search_regular_code(raw_name)
        try:
            _sb().table("scheme_code_map").upsert({
                "raw_name": key, "scheme_code": code, "resolved_name": resolved,
                "updated_at": _now_iso(),
            }).execute()
        except Exception:
            pass
        return code
    # local
    store = _load_local()
    cm = store.setdefault("code_map", {})
    if key in cm:
        return cm[key].get("scheme_code")
    code, resolved = _search_regular_code(raw_name)
    cm[key] = {"scheme_code": code, "resolved_name": resolved}
    _save_local(store)
    return code


def live_nav(scheme_code: int, max_age_hours: int = 6) -> tuple[float | None, str | None]:
    """Latest regular-plan NAV for a scheme code, cached for a few hours."""
    if not scheme_code:
        return None, None
    now = datetime.now(timezone.utc)

    def _fetch() -> tuple[float | None, str | None, str | None]:
        try:
            r = httpx.get(f"{MFAPI}/mf/{scheme_code}/latest", timeout=12)
            j = r.json()
            data = (j.get("data") or [{}])[0]
            nm = (j.get("meta") or {}).get("scheme_name")
            return _to_float(data.get("nav")) or None, data.get("date"), nm
        except Exception:
            return None, None, None

    if _use_supabase():
        try:
            r = _sb().table("scheme_nav_cache").select("*").eq("scheme_code", scheme_code).limit(1).execute()
            if r.data:
                row = r.data[0]
                fetched = row.get("fetched_at")
                if fetched:
                    age = (now - datetime.fromisoformat(fetched.replace("Z", "+00:00"))).total_seconds() / 3600
                    if age < max_age_hours and row.get("nav"):
                        return float(row["nav"]), row.get("nav_date")
        except Exception:
            pass
        nav, ndate, nm = _fetch()
        if nav:
            try:
                _sb().table("scheme_nav_cache").upsert({
                    "scheme_code": scheme_code, "scheme_name": nm, "nav": nav,
                    "nav_date": ndate, "fetched_at": _now_iso(),
                }).execute()
            except Exception:
                pass
        return nav, ndate
    # local
    store = _load_local()
    cache = store.setdefault("nav_cache", {})
    row = cache.get(str(scheme_code))
    if row:
        try:
            age = (now - datetime.fromisoformat(row["fetched_at"])).total_seconds() / 3600
            if age < max_age_hours and row.get("nav"):
                return float(row["nav"]), row.get("nav_date")
        except Exception:
            pass
    nav, ndate, nm = _fetch()
    if nav:
        cache[str(scheme_code)] = {"nav": nav, "nav_date": ndate, "fetched_at": _now_iso()}
        _save_local(store)
    return nav, ndate


# ============================================================================
# UPLOAD (store proof + parse + replace same day)
# ============================================================================
def _store_file(report_date: str, report_type: str, filename: str, content: bytes) -> str | None:
    """Put the raw file in storage as proof; return its path. One per day/type."""
    ext = os.path.splitext(filename)[1] or ""
    path = f"{report_date}/{report_type}{ext}"
    if _use_supabase():
        cl = _sb()
        try:
            cl.storage.create_bucket(_BUCKET, options={"public": False})
        except Exception:
            pass
        try:
            cl.storage.from_(_BUCKET).upload(
                path, content, {"content-type": "application/octet-stream", "upsert": "true"})
        except Exception:
            # already exists → replace
            try:
                cl.storage.from_(_BUCKET).update(path, content, {"upsert": "true"})
            except Exception:
                return None
        return path
    # local
    os.makedirs(os.path.join(_FILES_DIR, report_date), exist_ok=True)
    disk = os.path.join(_FILES_DIR, report_date, f"{report_type}{ext}")
    with open(disk, "wb") as f:
        f.write(content)
    return disk


def upload_report(report_type: str, filename: str, content: bytes,
                  report_date: str | None = None) -> dict:
    """Store the file as proof, parse it, and replace that day's data."""
    if report_type not in ("user", "transaction"):
        raise ValueError("report_type must be 'user' or 'transaction'")

    if report_type == "transaction":
        rows, parsed_date = parse_transaction_csv(content)
        report_date = report_date or parsed_date or datetime.now().strftime("%Y-%m-%d")
    else:
        rows = parse_user_report(content, filename)
        report_date = report_date or datetime.now().strftime("%Y-%m-%d")

    storage_path = _store_file(report_date, report_type, filename, content)

    if report_type == "user":
        _save_clients(rows, report_date)
    else:
        _save_holdings(rows, report_date)

    meta = {
        "report_date": report_date, "report_type": report_type,
        "filename": filename, "storage_path": storage_path,
        "size_bytes": len(content), "row_count": len(rows),
        "status": "parsed", "uploaded_at": _now_iso(),
    }
    _record_upload(meta)
    return meta


def _record_upload(meta: dict) -> None:
    if _use_supabase():
        try:
            _sb().table("report_uploads").upsert(
                meta, on_conflict="report_date,report_type").execute()
            return
        except Exception:
            pass
    store = _load_local()
    ups = [u for u in store.get("uploads", [])
           if not (u["report_date"] == meta["report_date"] and u["report_type"] == meta["report_type"])]
    ups.append({"id": str(uuid.uuid4()), **meta})
    store["uploads"] = ups
    _save_local(store)


def _save_clients(rows: list[dict], report_date: str) -> None:
    for r in rows:
        r["signup"] = r.get("signup", "")
        r["updated_at"] = _now_iso()
    if _use_supabase():
        try:
            for r in rows:
                _sb().table("client_master").upsert(r, on_conflict="client_code").execute()
            return
        except Exception:
            pass
    store = _load_local()
    clients = store.setdefault("clients", {})
    for r in rows:
        clients[r["client_code"]] = r
    _save_local(store)


def _save_holdings(rows: list[dict], report_date: str) -> None:
    """Replace ALL holdings with the latest transaction report (one per day)."""
    enriched = []
    for r in rows:
        code = resolve_scheme_code(r["scheme_name"])
        enriched.append({
            "client_code": r["client_code"], "scheme_name": r["scheme_name"],
            "scheme_code": code, "folio_no": r.get("folio_no", ""),
            "units": round(r["units"], 4), "invested": round(r["invested"], 2),
            "last_nav": r.get("last_nav"), "report_date": report_date,
            "updated_at": _now_iso(),
        })
    if _use_supabase():
        try:
            _sb().table("client_holdings").delete().neq("client_code", "__none__").execute()
            for r in enriched:
                _sb().table("client_holdings").upsert(
                    r, on_conflict="client_code,scheme_name,folio_no").execute()
            return
        except Exception:
            pass
    store = _load_local()
    store["holdings"] = enriched
    _save_local(store)


# ============================================================================
# READS
# ============================================================================
def list_uploads() -> list[dict]:
    if _use_supabase():
        try:
            return _sb().table("report_uploads").select("*").order("report_date", desc=True).execute().data or []
        except Exception:
            pass
    return sorted(_load_local().get("uploads", []), key=lambda u: u.get("report_date", ""), reverse=True)


def today_status(report_date: str) -> dict:
    ups = [u for u in list_uploads() if u.get("report_date") == report_date]
    return {
        "report_date": report_date,
        "user": next((u for u in ups if u["report_type"] == "user"), None),
        "transaction": next((u for u in ups if u["report_type"] == "transaction"), None),
    }


def upload_calendar(start: str, end: str) -> list[dict]:
    """Per-day upload status for the [start, end] window (inclusive, ISO dates).

    Powers the admin calendar heatmap: for every day we say whether the User
    Report and Transaction Report were uploaded. status is:
      • "both"    — both reports present
      • "partial" — exactly one present
      • "none"    — neither present
    Only days that fall in the window are returned; the frontend lays them onto
    a month grid.
    """
    from datetime import date, timedelta
    d0 = date.fromisoformat(start)
    d1 = date.fromisoformat(end)
    if d1 < d0:
        d0, d1 = d1, d0
    # index uploads by day → {type: upload}
    by_day: dict[str, dict] = {}
    for u in list_uploads():
        by_day.setdefault(u.get("report_date"), {})[u.get("report_type")] = u
    out = []
    cur = d0
    while cur <= d1:
        key = cur.isoformat()
        got = by_day.get(key, {})
        has_user = "user" in got
        has_txn = "transaction" in got
        n = int(has_user) + int(has_txn)
        out.append({
            "date": key,
            "user": got.get("user"),
            "transaction": got.get("transaction"),
            "status": "both" if n == 2 else ("partial" if n == 1 else "none"),
        })
        cur += timedelta(days=1)
    return out


def _all_clients() -> list[dict]:
    if _use_supabase():
        try:
            return _sb().table("client_master").select("*").order("name").execute().data or []
        except Exception:
            pass
    return list(_load_local().get("clients", {}).values())


def _client(code: str) -> dict | None:
    if _use_supabase():
        try:
            r = _sb().table("client_master").select("*").eq("client_code", code).limit(1).execute()
            return r.data[0] if r.data else None
        except Exception:
            pass
    return _load_local().get("clients", {}).get(code)


def _holdings(code: str) -> list[dict]:
    if _use_supabase():
        try:
            return _sb().table("client_holdings").select("*").eq("client_code", code).execute().data or []
        except Exception:
            pass
    return [h for h in _load_local().get("holdings", []) if h["client_code"] == code]


def list_clients_summary() -> list[dict]:
    """Light list for the CRM grid: name, code, net worth, invested, gain."""
    out = []
    for c in _all_clients():
        code = c["client_code"]
        val = _valuate(_holdings(code))
        out.append({
            "client_code": code, "name": c.get("name", "").strip(),
            "city": c.get("city", ""), "phone": c.get("phone", ""),
            "net_worth": val["net_worth"], "invested": val["invested"],
            "gain": val["gain"], "gain_pct": val["gain_pct"],
            "holdings_count": val["count"],
        })
    return sorted(out, key=lambda x: x["net_worth"], reverse=True)


def _valuate(holdings: list[dict]) -> dict:
    """Compute live net worth from holdings using regular-plan NAVs."""
    net = invested = 0.0
    detailed = []
    for h in holdings:
        units = float(h.get("units") or 0)
        inv = float(h.get("invested") or 0)
        code = h.get("scheme_code")
        nav, ndate = live_nav(code) if code else (None, None)
        if nav is None:
            nav = float(h.get("last_nav") or 0)  # fall back to report NAV
        cur = round(units * nav, 2)
        net += cur
        invested += inv
        detailed.append({
            "scheme_name": h.get("scheme_name"), "scheme_code": code,
            "folio_no": h.get("folio_no"), "units": units, "invested": round(inv, 2),
            "nav": nav, "nav_date": ndate, "current_value": cur,
            "gain": round(cur - inv, 2),
        })
    gain = round(net - invested, 2)
    return {
        "net_worth": round(net, 2), "invested": round(invested, 2), "gain": gain,
        "gain_pct": round((gain / invested * 100) if invested else 0, 2),
        "count": len(holdings), "holdings": detailed,
    }


def client_detail(code: str) -> dict | None:
    c = _client(code)
    if not c:
        return None
    hold = _holdings(code)
    val = _valuate(hold)
    villas = _match_villas(val["holdings"])
    matched_codes = {s for v in villas for s in v["scheme_codes"]}
    extra = [h for h in val["holdings"] if h["scheme_code"] not in matched_codes]
    return {
        "client": c,
        "net_worth": val["net_worth"], "invested": val["invested"],
        "gain": val["gain"], "gain_pct": val["gain_pct"],
        "villas": villas, "villa_count": len(villas),
        "extra": extra,
        "holdings": val["holdings"],
    }


# ============================================================================
# VILLA BUCKETS
# ============================================================================
def list_buckets() -> list[dict]:
    if _use_supabase():
        try:
            bs = _sb().table("villa_buckets").select("*").order("sort_order").execute().data or []
            for b in bs:
                b["funds"] = _sb().table("villa_bucket_funds").select("*").eq(
                    "bucket_id", b["id"]).order("sort_order").execute().data or []
            return bs
        except Exception:
            pass
    store = _load_local()
    bs = list(store.get("buckets", []))
    for b in bs:
        b["funds"] = sorted(
            [f for f in store.get("bucket_funds", []) if f["bucket_id"] == b["id"]],
            key=lambda f: f.get("sort_order", 0))
    return sorted(bs, key=lambda b: b.get("sort_order", 0))


def _fund_row(bid: str, f: dict, order: int) -> dict:
    """Normalize one fund of a bucket into a villa_bucket_funds row. Carries the
    allocation % (target_weight), category, and past returns so a bucket renders
    the client SIP modal (Scheme · Category · Allocation · 1/3/5-Yr returns)."""
    def num(v):
        try:
            return round(float(v), 4) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
    return {
        "id": str(uuid.uuid4()), "bucket_id": bid,
        "scheme_name": f.get("scheme_name"), "scheme_code": f.get("scheme_code"),
        "category": (f.get("category") or None),
        "target_weight": num(f.get("target_weight")) or 0,
        "ret_1y": num(f.get("ret_1y")), "ret_3y": num(f.get("ret_3y")),
        "ret_5y": num(f.get("ret_5y")), "sort_order": order,
    }


def create_bucket(name: str, tier: str | None, funds: list[dict],
                  kind: str = "sip", subtitle: str | None = None) -> dict:
    """funds: [{scheme_name, scheme_code?, category?, target_weight?,
    ret_1y?, ret_3y?, ret_5y?}]. Resolves codes; keeps the ratio (target_weight).
    kind: 'sip' | 'lumpsum'. subtitle: e.g. 'medium risk portfolio'."""
    bid = str(uuid.uuid4())
    kind = "lumpsum" if str(kind).lower() == "lumpsum" else "sip"
    for f in funds:
        if not f.get("scheme_code") and f.get("scheme_name"):
            f["scheme_code"] = resolve_scheme_code(f["scheme_name"])
    rows = [_fund_row(bid, f, i) for i, f in enumerate(funds)]
    meta = {"id": bid, "name": name, "tier": tier, "kind": kind,
            "subtitle": subtitle, "sort_order": 0}
    if _use_supabase():
        try:
            _sb().table("villa_buckets").insert(meta).execute()
            for r in rows:
                _sb().table("villa_bucket_funds").insert(r).execute()
            return {**meta, "funds": rows}
        except Exception:
            pass
    store = _load_local()
    store.setdefault("buckets", []).append(meta)
    store.setdefault("bucket_funds", []).extend(rows)
    _save_local(store)
    return {**meta, "funds": rows}


def delete_bucket(bid: str) -> None:
    if _use_supabase():
        try:
            _sb().table("villa_buckets").delete().eq("id", bid).execute()
            return
        except Exception:
            pass
    store = _load_local()
    store["buckets"] = [b for b in store.get("buckets", []) if b["id"] != bid]
    store["bucket_funds"] = [f for f in store.get("bucket_funds", []) if f["bucket_id"] != bid]
    _save_local(store)


def _match_villas(detailed_holdings: list[dict]) -> list[dict]:
    """Match a client's holdings into villa buckets. A villa is 'owned' if the
    client holds ANY of its schemes; value = Σ current_value of matched funds."""
    by_code = {h["scheme_code"]: h for h in detailed_holdings if h.get("scheme_code")}
    out = []
    for b in list_buckets():
        codes = [f.get("scheme_code") for f in b.get("funds", []) if f.get("scheme_code")]
        owned = [by_code[c] for c in codes if c in by_code]
        if not owned:
            continue
        value = round(sum(h["current_value"] for h in owned), 2)
        invested = round(sum(h["invested"] for h in owned), 2)
        out.append({
            "bucket_id": b["id"], "name": b["name"], "tier": b.get("tier"),
            "scheme_codes": codes,
            "owned_count": len(owned), "total_funds": len(codes),
            "complete": len(owned) == len(codes) and len(codes) > 0,
            "value": value, "invested": invested,
            "gain": round(value - invested, 2),
            "funds": owned,
        })
    return out


def villas_live() -> list[dict]:
    """Live price of each villa bucket = Σ (units held by ALL clients × live NAV).
    Also returns the per-unit 'reference price' of one full villa mix."""
    all_hold = []
    for c in _all_clients():
        all_hold += _holdings(c["client_code"])
    val_all = _valuate(all_hold)
    by_code = {}
    for h in val_all["holdings"]:
        if h.get("scheme_code"):
            by_code.setdefault(h["scheme_code"], []).append(h)
    out = []
    for b in list_buckets():
        funds = []
        total = 0.0
        for f in b.get("funds", []):
            code = f.get("scheme_code")
            nav, ndate = live_nav(code) if code else (None, None)
            funds.append({
                "scheme_name": f.get("scheme_name"), "scheme_code": code,
                "nav": nav, "nav_date": ndate, "target_weight": f.get("target_weight", 0),
            })
            total += nav or 0
        out.append({
            "bucket_id": b["id"], "name": b["name"], "tier": b.get("tier"),
            "funds": funds, "nav_sum": round(total, 4),
        })
    return out
