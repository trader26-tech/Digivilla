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
import time as _time
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


def parse_transactions_raw(content: bytes) -> list[dict]:
    """Return the UN-aggregated transaction rows (one per report line), keyed by
    the AMC Order Id. Powers the admin's manual transaction → villa mapping.
    Order Id is stable, so re-uploads can preserve prior villa assignments."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    out: list[dict] = []
    seen: dict[str, tuple] = {}
    for row in reader:
        code = (row.get("Client Code") or "").strip()
        scheme = (row.get("Scheme Name") or "").strip()
        oid = (row.get("Order Id") or row.get("Order ID") or "").strip()
        if not code or not scheme:
            continue
        # fall back to a synthetic id when a line has no order id, so nothing is lost
        if not oid:
            oid = f"{code}:{scheme}:{(row.get('Folio No') or '').strip()}:{(row.get('NAV Date') or '').strip()}:{(row.get('Amount') or '').strip()}"
        # one AMC order id normally = one line; when a file repeats an id for a
        # different line (another scheme/folio), keep it under a stable suffix
        # instead of silently dropping money — an exact repeat is skipped
        sig = (scheme, (row.get("Folio No") or "").strip(), (row.get("Amount") or "").strip())
        if oid in seen:
            if seen[oid] == sig:
                continue
            n = 2
            while f"{oid}#{n}" in seen:
                n += 1
            oid = f"{oid}#{n}"
        seen[oid] = sig
        out.append({
            "order_id": oid,
            "client_code": code,
            "txn_date": _norm_date((row.get("NAV Date") or "").strip()) or None,
            "scheme_name": scheme,
            "folio_no": (row.get("Folio No") or "").strip(),
            "kind": (row.get("Transaction") or "").strip() or None,
            "amount": _to_float(row.get("Amount")),
            "nav": _to_float(row.get("NAV")),
            "units": _to_float(row.get("Units")),
        })
    return out


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


# Process-lifetime memo so a scheme resolved once (this run) is never looked up
# again — keyed by the normalised name. Cleared implicitly on restart.
_CODE_MEMO: dict[str, int | None] = {}


def resolve_scheme_code(raw_name: str) -> int | None:
    """Cached resolve: raw scheme name → regular-plan code.

    Fast path is the in-memory memo, then the persistent cache (DB or local),
    then a live mfapi search as a last resort. For bulk work prefer
    resolve_scheme_codes(), which resolves the misses in parallel."""
    key = _norm_scheme(raw_name)
    if key in _CODE_MEMO:
        return _CODE_MEMO[key]
    return resolve_scheme_codes([raw_name]).get(raw_name)


def resolve_scheme_codes(raw_names: list[str]) -> dict[str, int | None]:
    """Resolve many raw scheme names → regular-plan codes at once.

    Distinct names are resolved once; hits come from the in-memory memo and the
    persistent cache, and only the remaining misses hit mfapi — in parallel,
    with one bulk write back to the cache. Returns {raw_name: code} for every
    input (including duplicates)."""
    # distinct (raw_name, key) pairs, preserving one representative raw per key
    key_of: dict[str, str] = {}          # raw_name -> normalised key
    rep_raw: dict[str, str] = {}         # key -> a raw name to search with
    for raw in raw_names:
        k = _norm_scheme(raw)
        key_of[raw] = k
        rep_raw.setdefault(k, raw)

    resolved: dict[str, int | None] = {}  # key -> code

    # 1) in-memory memo
    for k in list(rep_raw):
        if k in _CODE_MEMO:
            resolved[k] = _CODE_MEMO[k]

    # 2) persistent cache (one bulk read)
    misses = [k for k in rep_raw if k not in resolved]
    use_sb = _use_supabase()
    store = None if use_sb else _load_local()
    if misses:
        if use_sb:
            try:
                got = _sb().table("scheme_code_map").select(
                    "raw_name,scheme_code").in_("raw_name", misses).execute().data or []
                for row in got:
                    resolved[row["raw_name"]] = row.get("scheme_code")
            except Exception:
                pass
        else:
            cm = store.setdefault("code_map", {})
            for k in misses:
                if k in cm:
                    resolved[k] = cm[k].get("scheme_code")

    # 3) live mfapi search for whatever's still missing — in parallel
    still = [k for k in rep_raw if k not in resolved]
    if still:
        import concurrent.futures as _fut
        fresh: dict[str, tuple[int | None, str | None]] = {}
        with _fut.ThreadPoolExecutor(max_workers=min(8, len(still))) as ex:
            futs = {ex.submit(_search_regular_code, rep_raw[k]): k for k in still}
            for fu in _fut.as_completed(futs):
                k = futs[fu]
                try:
                    fresh[k] = fu.result()
                except Exception:
                    fresh[k] = (None, None)
        for k, (code, _name) in fresh.items():
            resolved[k] = code
        # write the freshly-resolved ones back to the persistent cache (bulk)
        if use_sb:
            try:
                _sb().table("scheme_code_map").upsert([{
                    "raw_name": k, "scheme_code": c, "resolved_name": n,
                    "updated_at": _now_iso(),
                } for k, (c, n) in fresh.items()]).execute()
            except Exception:
                pass
        else:
            cm = store.setdefault("code_map", {})
            for k, (c, n) in fresh.items():
                cm[k] = {"scheme_code": c, "resolved_name": n}
            _save_local(store)

    # memo everything and map back to every input raw name
    _CODE_MEMO.update(resolved)
    return {raw: resolved.get(key_of[raw]) for raw in raw_names}


# NAVs already looked up by this worker: {code: (time, nav, nav_date)}. A page
# values the same handful of funds for every client — without this each lookup
# was its own Supabase round-trip (~0.2 s), dozens per page.
_NAV_MEMO: dict = {}
_NAV_MEMO_S = 600


def _nav_memo_get(code) -> tuple[float | None, str | None] | None:
    hit = _NAV_MEMO.get(code)
    if hit and hit[1] and (_time.time() - hit[0]) < _NAV_MEMO_S:
        return hit[1], hit[2]
    return None


def prime_navs(codes, max_age_hours: int = 6) -> None:
    """Look up many NAVs at once: ONE read of scheme_nav_cache for all of them,
    then any missing / stale ones fetched in parallel (the same source and rules
    as live_nav). Afterwards live_nav() answers them from memory."""
    want = sorted({int(c) for c in codes if c} - {c for c in _NAV_MEMO if _nav_memo_get(c)})
    if not want:
        return
    stale = list(want)
    if _use_supabase():
        try:
            rows = _sb().table("scheme_nav_cache").select("scheme_code,nav,nav_date,fetched_at") \
                .in_("scheme_code", want).execute().data or []
            now = datetime.now(timezone.utc)
            fresh = set()
            for r in rows:
                f = r.get("fetched_at")
                if f and r.get("nav"):
                    age = (now - datetime.fromisoformat(f.replace("Z", "+00:00"))).total_seconds() / 3600
                    if age < max_age_hours:
                        _NAV_MEMO[int(r["scheme_code"])] = (_time.time(), float(r["nav"]), r.get("nav_date"))
                        fresh.add(int(r["scheme_code"]))
            stale = [c for c in want if c not in fresh]
        except Exception:
            pass
    if stale:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(8, len(stale))) as ex:
            list(ex.map(lambda c: live_nav(c, max_age_hours), stale))


def live_nav(scheme_code: int, max_age_hours: int = 6) -> tuple[float | None, str | None]:
    """Latest regular-plan NAV for a scheme code, cached for a few hours."""
    if not scheme_code:
        return None, None
    hit = _nav_memo_get(scheme_code)
    if hit:
        return hit
    nav, ndate = _live_nav(scheme_code, max_age_hours)
    if nav:
        _NAV_MEMO[scheme_code] = (_time.time(), nav, ndate)
    return nav, ndate


# AMFI's own NAV file — the same primary source the client app uses. It carries tonight's NAVs
# hours before the mfapi mirror does; one snapshot per worker, re-read every 15 minutes.
_AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
_AMFI_SNAP: tuple[float, dict] = (0.0, {})


def _amfi_snapshot() -> dict:
    """{scheme_code: (nav, nav_date_iso)} from AMFI, or the last good copy ({} if never)."""
    global _AMFI_SNAP
    if _AMFI_SNAP[1] and _time.time() - _AMFI_SNAP[0] < 900:
        return _AMFI_SNAP[1]
    try:
        r = httpx.get(_AMFI_URL, timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        out: dict = {}
        for line in r.text.splitlines():
            parts = line.split(";")
            if len(parts) < 8 or not parts[0].strip().isdigit():
                continue
            try:
                out[int(parts[0])] = (float(parts[-2]), datetime.strptime(parts[-1].strip(), "%d-%b-%Y").date().isoformat())
            except ValueError:
                continue
        if out:
            _AMFI_SNAP = (_time.time(), out)
    except Exception:
        pass
    return _AMFI_SNAP[1]


def _nav_iso(d) -> str | None:
    """A NAV date as ISO: AMFI gives ISO (above), mfapi gives '23-10-2026'."""
    d = str(d or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        return d
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", d)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _live_nav(scheme_code: int, max_age_hours: int = 6) -> tuple[float | None, str | None]:
    now = datetime.now(timezone.utc)

    def _fetch() -> tuple[float | None, str | None, str | None]:
        hit = _amfi_snapshot().get(int(scheme_code))         # AMFI first — authoritative and fresher
        if hit:
            return hit[0], hit[1], None
        try:
            r = httpx.get(f"{MFAPI}/mf/{scheme_code}/latest", timeout=12)
            j = r.json()
            data = (j.get("data") or [{}])[0]
            nm = (j.get("meta") or {}).get("scheme_name")
            return _to_float(data.get("nav")) or None, _nav_iso(data.get("date")), nm
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
                    if age < max_age_hours and row.get("nav") and _nav_iso(row.get("nav_date")):
                        return float(row["nav"]), _nav_iso(row.get("nav_date"))
        except Exception:
            row = None
        nav, ndate, nm = _fetch()
        if nav and ndate:
            # never put an older NAV over a newer one (the client app's refresher may have tonight's already)
            have = _nav_iso((row or {}).get("nav_date")) if row else None
            if have and have > ndate and row.get("nav"):
                return float(row["nav"]), have
            try:
                _sb().table("scheme_nav_cache").upsert({
                    "scheme_code": scheme_code, "scheme_name": nm or (row or {}).get("scheme_name"), "nav": nav,
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
    """Store the file as proof, parse it, and fold it into the record.

    A Transaction Report ADDS to what is already known: every line is keyed by
    its AMC order id, so a line seen before updates in place and nothing is ever
    counted twice. Holdings are then rebuilt from the WHOLE transaction history
    (never from one day's file), so a client's invested total only ever grows
    with new money. The result says how many lines were new vs already known."""
    if report_type not in ("user", "transaction"):
        raise ValueError("report_type must be 'user' or 'transaction'")

    stats: dict = {}
    if report_type == "transaction":
        _, parsed_date = parse_transaction_csv(content)
        report_date = report_date or parsed_date or datetime.now().strftime("%Y-%m-%d")
        raw_txns = parse_transactions_raw(content)
        if not raw_txns:
            raise ValueError("No transactions found — is this the Transaction Report (Client Code, Order Id, Scheme Name, Units, Amount…)?")
        rows = raw_txns
    else:
        rows = parse_user_report(content, filename)
        report_date = report_date or datetime.now().strftime("%Y-%m-%d")

    storage_path = _store_file(report_date, report_type, filename, content)

    if report_type == "user":
        _save_clients(rows, report_date)
    else:
        codes = resolve_scheme_codes([r["scheme_name"] for r in raw_txns])
        # 1 · the per-line record (upsert by order id: new lines added, known
        #     lines refreshed, villa pins kept, hand-added purchases absorbed)
        stats = _save_transactions(raw_txns, report_date, codes)
        # 2 · holdings = roll-up of EVERY transaction of the clients in this file
        touched = sorted({r["client_code"] for r in raw_txns})
        stats["holdings"] = rebuild_holdings(touched)
        # the money-out lines in this file (SWP · redemption · switch-out), each with what it took off
        stats["withdrawals"] = _withdrawals_of(raw_txns, stats["holdings"].get("unmatched_out") or [])
        stats["clients"] = touched
        # the commission figures and the trail ledger are cached — new holdings must show at once
        try:
            from app import commission as _comm
            _comm._CACHE.clear()
        except Exception:
            pass
        # 3 · place every new purchase into its villa bucket — or list it for a decision
        try:
            from app import placement
            pl = placement.run(touched)
            stats["placement"] = {"auto": pl["auto"], "pending": pl["pending"],
                                  "pending_count": len(pl["pending"]), "auto_count": len(pl["auto"])}
        except Exception as e:                                   # never lose an upload over placement
            stats["placement"] = {"error": str(e), "auto": [], "pending": [], "pending_count": 0, "auto_count": 0}

    meta = {
        "report_date": report_date, "report_type": report_type,
        "filename": filename, "storage_path": storage_path,
        "size_bytes": len(content), "row_count": len(rows),
        "status": "parsed", "uploaded_at": _now_iso(),
    }
    _record_upload(meta)
    return {**meta, **stats}


def _withdrawals_of(raw_txns: list[dict], orphans: list[dict]) -> list[dict]:
    """Every money-out line of an upload, for the portal: who, which fund, ₹ and
    units taken off, and whether it found the fund it comes off."""
    out = [r for r in raw_txns if _signed(r, "units") < 0 or _signed(r, "amount") < 0]
    if not out:
        return []
    names = {}
    try:
        codes = sorted({r["client_code"] for r in out})
        for c in _sb().table("client_master").select("client_code,name").in_("client_code", codes).execute().data or []:
            names[c["client_code"]] = (c.get("name") or "").strip()
    except Exception:
        pass
    lost = {(o["client_code"], o["scheme_name"]) for o in orphans}
    return [{"client_code": r["client_code"], "name": names.get(r["client_code"]) or r["client_code"],
             "scheme_name": r["scheme_name"], "kind": r.get("kind") or "Redemption", "txn_date": r.get("txn_date"),
             "amount": round(abs(_to_float(r.get("amount"))), 2), "units": round(abs(_to_float(r.get("units"))), 4),
             "deducted": (r["client_code"], r["scheme_name"]) not in lost}
            for r in sorted(out, key=lambda r: (r["client_code"], str(r.get("txn_date") or "")))]


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


def _fund_key(t: dict) -> str:
    """Which fund a line is, however the report spelt it: the AMFI scheme code
    when known, else the name without case, punctuation or plan words."""
    if t.get("scheme_code"):
        return f"c:{t['scheme_code']}"
    import re
    n = re.sub(r"[^a-z0-9]+", " ", str(t.get("scheme_name") or "").lower())
    n = re.sub(r"\b(fund|plan|option|regular|growth|the)\b", " ", n)
    return "n:" + " ".join(n.split())


def _holdings_from_txns(txns: list[dict], orphans: list | None = None) -> list[dict]:
    """Roll transactions up into holdings rows: one per (client, scheme, folio).
    Units are signed (money out — redemption, SWP, switch-out — takes units
    away); `invested` is the money PUT IN only — a withdrawal never lowers it
    (the user's rule, 2026-10-26: what was invested stays what was invested;
    withdrawals are counted separately). Last NAV = the latest line's.

    A withdrawal ALWAYS comes off the fund it belongs to: when its folio or the
    scheme's spelling differs from the purchase lines (AMC reports vary:
    "10219145/94" vs "10219145", upper vs title case), it would otherwise form a
    group of its own with negative units — which used to be dropped as "fully
    redeemed", so the money was never taken off. Such a group is now netted
    against the same client's same fund (largest folio first). A withdrawal
    with no fund to come off is never dropped silently: it is appended to
    `orphans` for the admin to see."""
    agg: dict[tuple, dict] = {}
    for t in sorted(txns, key=lambda t: (str(t.get("txn_date") or ""), str(t.get("order_id") or ""))):
        key = (t["client_code"], t["scheme_name"], t.get("folio_no") or "")
        e = agg.setdefault(key, {
            "client_code": t["client_code"], "scheme_name": t["scheme_name"],
            "scheme_code": t.get("scheme_code"), "folio_no": t.get("folio_no") or "",
            "units": 0.0, "invested": 0.0, "last_nav": None, "report_date": None, "_fund": _fund_key(t),
        })
        e["units"] += _signed(t, "units")
        # invested = money PUT IN: a withdrawal (SWP · redemption) takes units off, never the invested ₹
        if _signed(t, "amount") > 0:
            e["invested"] += _signed(t, "amount")
        if t.get("scheme_code") and not e["scheme_code"]:
            e["scheme_code"] = t["scheme_code"]
            e["_fund"] = _fund_key(e)
        if _to_float(t.get("nav")):
            e["last_nav"] = _to_float(t.get("nav"))
        rd = str(t.get("report_date") or t.get("txn_date") or "")[:10] or None
        if rd and (not e["report_date"] or rd > e["report_date"]):
            e["report_date"] = rd
    # net any money-out group against the same client's same fund
    for e in [x for x in agg.values() if x["units"] < -1e-4]:
        pool = sorted((x for x in agg.values() if x is not e and x["client_code"] == e["client_code"]
                       and x["_fund"] == e["_fund"] and x["units"] > 1e-4), key=lambda x: -x["units"])
        for x in pool:
            if e["units"] >= -1e-4:
                break
            take = min(x["units"], -e["units"])
            x["units"] -= take
            e["units"] += take
        if e["units"] < -1e-4 and orphans is not None:
            orphans.append({"client_code": e["client_code"], "scheme_name": e["scheme_name"], "folio_no": e["folio_no"],
                            "units": round(e["units"], 4)})
    # a folio emptied by a withdrawal still carries the money put into it: that belongs to the
    # fund, so it moves onto the folios of it still held (by units) — the fund's invested stays whole
    funds: dict[tuple, list] = {}
    for e in agg.values():
        funds.setdefault((e["client_code"], e["_fund"]), []).append(e)
    for grp in funds.values():
        live = [x for x in grp if x["units"] > 1e-4]
        dead = [x for x in grp if x["units"] <= 1e-4 and abs(x["invested"]) > 0.005]
        if not live or not dead:
            continue
        extra = sum(x["invested"] for x in dead)
        tot = sum(x["units"] for x in live)
        for x in live:
            x["invested"] += extra * x["units"] / tot
        for x in dead:
            x["invested"] = 0.0
    out = []
    for e in agg.values():
        e.pop("_fund", None)
        e["units"] = round(e["units"], 4)
        e["invested"] = round(e["invested"], 2)
        if e["units"] <= 1e-4:
            continue                                   # fully redeemed → no holding (its money in still counts via the transactions)
        e["updated_at"] = _now_iso()
        out.append(e)
    return out


def rebuild_holdings(client_codes: list[str] | None = None) -> dict:
    """Make `client_holdings` equal the roll-up of `client_transactions` — for
    the given clients, or for every client that has transactions.

    This is the ONLY writer of holdings. It is idempotent and safe to run any
    time (after an upload, a hand-added purchase, or as a repair): rows that
    the transactions no longer support are removed, the rest upserted on the
    table's (client, scheme, folio) key. A client with holdings but NO
    transactions at all is left untouched and reported, never wiped."""
    if _use_supabase():
        txns = _all_rows("client_transactions", "order_id,client_code,txn_date,scheme_name,scheme_code,folio_no,kind,amount,nav,units,report_date")
        if client_codes is not None:
            want = set(client_codes)
            txns = [t for t in txns if t["client_code"] in want]
        codes = {t["client_code"] for t in txns}
        if client_codes is not None:
            codes |= set(client_codes)
        orphans: list = []
        rows = _holdings_from_txns(txns, orphans)
        removed = 0
        for code in codes:
            have = _sb().table("client_holdings").select("id,scheme_name,folio_no").eq("client_code", code).execute().data or []
            mine = {(r["scheme_name"], r["folio_no"]) for r in rows if r["client_code"] == code}
            if not mine:
                continue                               # no transactions → leave as is (reported below)
            stale = [h["id"] for h in have if (h["scheme_name"], h.get("folio_no") or "") not in mine]
            if stale:
                _sb().table("client_holdings").delete().in_("id", stale).execute()
                removed += len(stale)
        if rows:
            _sb().table("client_holdings").upsert(rows, on_conflict="client_code,scheme_name,folio_no").execute()
        untouched = sorted(c for c in codes if not any(r["client_code"] == c for r in rows))
        return {"clients": len(codes), "rows": len(rows), "removed": removed, "no_transactions": untouched,
                "unmatched_out": orphans}
    store = _load_local()
    txns = store.get("transactions", [])
    if client_codes is not None:
        want = set(client_codes)
        keep = [h for h in store.get("holdings", []) if h["client_code"] not in want]
        rows = _holdings_from_txns([t for t in txns if t["client_code"] in want])
        store["holdings"] = keep + rows
    else:
        rows = _holdings_from_txns(txns)
        store["holdings"] = rows
    _save_local(store)
    return {"clients": len({r["client_code"] for r in rows}), "rows": len(rows), "removed": 0, "no_transactions": []}


def holdings_consistency() -> dict:
    """Does every client's holdings total equal their transactions total? The
    system's own tie-out — the admin home shows it and the audit page lists it."""
    txns = _all_rows("client_transactions", "order_id,client_code,txn_date,scheme_name,scheme_code,folio_no,kind,amount,nav,units") if _use_supabase() else _load_local().get("transactions", [])
    holds = _all_rows("client_holdings", "client_code,invested,units") if _use_supabase() else _load_local().get("holdings", [])
    names = {c["client_code"]: (c.get("name") or "").strip() for c in _all_clients()}
    per: dict[str, dict] = {}
    for t in txns:
        c = per.setdefault(t["client_code"], {"txn_amount": 0.0, "txn_units": 0.0, "hold_amount": 0.0, "hold_units": 0.0, "txns": 0})
        c["txns"] += 1
    # what the holdings SHOULD be is exactly the roll-up rule (money in only for ₹ — a withdrawal
    # takes units, never invested; a fully withdrawn fund leaves no row), so compare with that
    for e in _holdings_from_txns([t for t in txns if t.get("scheme_name")]):
        c = per.setdefault(e["client_code"], {"txn_amount": 0.0, "txn_units": 0.0, "hold_amount": 0.0, "hold_units": 0.0, "txns": 0})
        c["txn_amount"] += e["invested"]; c["txn_units"] += e["units"]
    for h in holds:
        c = per.setdefault(h["client_code"], {"txn_amount": 0.0, "txn_units": 0.0, "hold_amount": 0.0, "hold_units": 0.0, "txns": 0})
        c["hold_amount"] += _to_float(h.get("invested")); c["hold_units"] += _to_float(h.get("units"))
    clients = []
    for code, c in per.items():
        ok = abs(c["txn_amount"] - c["hold_amount"]) <= 1.0 and abs(c["txn_units"] - c["hold_units"]) <= 0.01
        clients.append({"client_code": code, "name": names.get(code) or code, "ok": ok,
                        "transactions": round(c["txn_amount"], 2), "holdings": round(c["hold_amount"], 2),
                        "diff": round(c["hold_amount"] - c["txn_amount"], 2), "txn_count": c["txns"]})
    clients.sort(key=lambda c: (c["ok"], -abs(c["diff"])))
    return {"as_of": _now_iso(), "ok": all(c["ok"] for c in clients),
            "clients": clients, "off": [c for c in clients if not c["ok"]]}


def _save_transactions(rows: list[dict], report_date: str, codes: dict[str, int | None] | None = None) -> dict:
    """Upsert raw transactions by order_id — NEVER delete-all, and NEVER clobber
    an existing manual `villa_id`. New txns are added; re-uploaded ones update
    their facts (units/nav) but keep whatever villa the admin assigned.

    Scheme codes are resolved once in a batch; existing rows are read in a single
    query and everything is written in one bulk upsert that carries each row's
    preserved villa_id, instead of a round-trip per transaction."""
    if not rows:
        return {"added": 0, "updated": 0, "absorbed": 0}
    if codes is None:
        codes = resolve_scheme_codes([r["scheme_name"] for r in rows])
    if _use_supabase():
        if True:
            # preserved villa_id per existing order_id (one query per client code)
            preserved: dict[str, str | None] = {}
            for code in {r["client_code"] for r in rows}:
                got = _sb().table("client_transactions").select("order_id,villa_id").eq(
                    "client_code", code).execute().data or []
                for t in got:
                    preserved[t["order_id"]] = t.get("villa_id")
            # hand-added purchases waiting for the report to confirm them
            manual: list[dict] = []
            for code in {r["client_code"] for r in rows}:
                manual += _sb().table("client_transactions").select("*").eq(
                    "client_code", code).like("order_id", "MAN-%").execute().data or []
            absorbed: set[str] = set()
            recs = []
            for r in rows:
                rec = {
                    "order_id": r["order_id"], "client_code": r["client_code"],
                    "txn_date": r.get("txn_date"), "scheme_name": r["scheme_name"],
                    "scheme_code": codes.get(r["scheme_name"]), "folio_no": r.get("folio_no", ""),
                    "kind": r.get("kind"), "amount": round(r.get("amount", 0), 2),
                    "nav": r.get("nav"), "units": round(r.get("units", 0), 4),
                    "report_date": report_date, "updated_at": _now_iso(),
                }
                # carry forward a manual villa assignment if this order already had one
                if r["order_id"] in preserved:
                    rec["villa_id"] = preserved[r["order_id"]]
                # the report now carries a purchase the admin added by hand →
                # the report's line wins, the hand-added one goes, the villa stays
                m = _match_manual(rec, manual, absorbed)
                if m:
                    absorbed.add(m["order_id"])
                    if not rec.get("villa_id"):
                        rec["villa_id"] = m.get("villa_id")
                recs.append(rec)
            if recs:
                _sb().table("client_transactions").upsert(
                    recs, on_conflict="order_id").execute()
            if absorbed:
                _sb().table("client_transactions").delete().in_("order_id", list(absorbed)).execute()
            known = sum(1 for r in rows if r["order_id"] in preserved)
            return {"added": len(rows) - known, "updated": known, "absorbed": len(absorbed)}
    store = _load_local()
    txns = {t["order_id"]: t for t in store.get("transactions", [])}
    known = sum(1 for r in rows if r["order_id"] in txns)
    for r in rows:
        prev = txns.get(r["order_id"], {})
        txns[r["order_id"]] = {**r, "report_date": report_date,
                               "scheme_code": codes.get(r["scheme_name"]),
                               "villa_id": prev.get("villa_id")}
    store["transactions"] = list(txns.values())
    _save_local(store)
    return {"added": len(rows) - known, "updated": known, "absorbed": 0}


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


def _holdings_by_client() -> dict[str, list[dict]]:
    """Every client's holdings in one read (paged), grouped by client code."""
    rows: list[dict] = []
    if _use_supabase():
        try:
            rows = _all_rows("client_holdings", "*")
        except Exception:
            rows = []
    else:
        rows = list(_load_local().get("holdings", []))
    by: dict[str, list[dict]] = {}
    for h in rows:
        by.setdefault(h.get("client_code"), []).append(h)
    return by


def list_clients_summary() -> list[dict]:
    """Light list for the CRM grid: name, code, net worth, invested, gain.
    Two reads in all (clients, holdings) + one batched NAV lookup."""
    clients = _all_clients()
    holdings = _holdings_by_client()
    prime_navs(h.get("scheme_code") for hs in holdings.values() for h in hs)
    out = []
    for c in clients:
        code = c["client_code"]
        val = _valuate(holdings.get(code, []))
        out.append({
            "client_code": code, "name": c.get("name", "").strip(),
            "city": c.get("city", ""), "phone": c.get("phone", ""),
            "net_worth": val["net_worth"], "invested": val["invested"],
            "gain": val["gain"], "gain_pct": val["gain_pct"],
            "holdings_count": val["count"],
            "demo": code == DEMO_CODE,
        })
    return sorted(out, key=lambda x: x["net_worth"], reverse=True)


def _valuate(holdings: list[dict]) -> dict:
    """Compute live net worth from holdings using regular-plan NAVs."""
    net = invested = 0.0
    detailed = []
    prime_navs(h.get("scheme_code") for h in holdings)
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
    # `sleeve` is the concentration bucket the client home allocation bar paints
    # (arbitrage/gold/large/mid/small/other). Normalised to the canonical token;
    # blank/unknown → None so the client infers it from category/name.
    _SLEEVES = {"arbitrage", "gold", "large", "mid", "small", "other"}
    sleeve = str(f.get("sleeve") or "").strip().lower() or None
    if sleeve not in _SLEEVES:
        sleeve = None
    return {
        "id": str(uuid.uuid4()), "bucket_id": bid,
        "scheme_name": f.get("scheme_name"), "scheme_code": f.get("scheme_code"),
        "category": (f.get("category") or None),
        "sleeve": sleeve,
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
                try:
                    _sb().table("villa_bucket_funds").insert(r).execute()
                except Exception:
                    # Migration 008 (the `sleeve` column) may not be applied yet —
                    # retry without it so bucket creation still works. The client
                    # then infers the sleeve from category/name until it's added.
                    _sb().table("villa_bucket_funds").insert(
                        {k: v for k, v in r.items() if k != "sleeve"}).execute()
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


# ============================================================================
# MANUAL TRANSACTION → VILLA MAPPING (admin)
# ============================================================================
VILLA_UNIT = 500_000.0   # a full villa = ₹5L invested (a UI hint, not enforced)


def _villa_unit() -> float:
    try:
        from app.calc_settings import calc_config
        return float(calc_config.estate()["villa_cost"])
    except Exception:
        return VILLA_UNIT


def _houses_max() -> int:
    """Villas a client can own — no longer the board's 9 parcels: the app swipes
    between estates of 9, so every ₹5 L is its own villa."""
    return 99


_VC: dict = {"at": 0.0, "codes": set()}


def _villa_codes() -> set:
    """Every fund in any DigiVilla bucket (memo 5 min) — the funds that build villas."""
    if _time.time() - _VC["at"] < 300 and _VC["codes"]:
        return _VC["codes"]
    try:
        rows = _all_rows("villa_bucket_funds", "scheme_code") if _use_supabase() else _load_local().get("bucket_funds", [])
        _VC.update(at=_time.time(), codes={int(r["scheme_code"]) for r in rows if r.get("scheme_code")})
    except Exception:
        pass
    return _VC["codes"]


def allocate_client(client_code: str, *, villas: list[dict] | None = None, txns: list[dict] | None = None) -> dict:
    """The client's villas by the shared rule (client/backend/app/villa_alloc.py)."""
    from app.shared_alloc import villa_alloc
    if villas is None:
        villas = (_sb().table("client_villas").select("*").eq("client_code", client_code).execute().data or []) if _use_supabase() \
            else [v for v in _load_local().get("client_villas", []) if v.get("client_code") == client_code]
    if txns is None:
        txns = list_transactions(client_code)
    from app import placement
    return villa_alloc.allocate(txns, villas, unit=_villa_unit(), max_houses=_houses_max(),
                                villa_codes=_villa_codes(), client_code=client_code,
                                set_bucket=placement.placement_map(), villa_bucket=placement.villa_bucket_map())
# The public demo account (client app → "Explore the demo", phone 9999999999).
# Its sample portfolio is seeded by client/backend/scripts/seed_demo.py; uploads
# never touch it and it is left out of the admin's totals and alerts.
DEMO_CODE = "DEV9999"


def list_transactions(client_code: str) -> list[dict]:
    """All raw transactions for a client, newest first, each with its villa_id."""
    if _use_supabase():
        try:
            return (_sb().table("client_transactions").select("*")
                    .eq("client_code", client_code).order("txn_date", desc=True)
                    .execute().data or [])
        except Exception:
            pass
    return sorted(
        [t for t in _load_local().get("transactions", []) if t.get("client_code") == client_code],
        key=lambda t: t.get("txn_date") or "", reverse=True)


def list_transactions_placed(client_code: str) -> list[dict]:
    """Transactions with `placements`: where each line's money sits by the shared
    rule — [{villa_id, position, amount, fraction}] (a split line lists several),
    or [] for a fund outside every DigiVilla bucket."""
    txns = list_transactions(client_code)
    try:
        r = allocate_client(client_code, txns=txns)
        pl = r["placements"]
        outside = {o["scheme_code"] for o in r["outside"]}
    except Exception:
        pl, outside = {}, set()
    for t in txns:
        t["placements"] = pl.get(t["order_id"], [])
        t["outside"] = bool(t.get("scheme_code") in outside and not t.get("villa_id"))
    return txns


def list_client_villas(client_code: str, *, villas: list[dict] | None = None,
                       txns: list[dict] | None = None, vtypes: dict | None = None) -> list[dict]:
    """The admin-created villas for a client + each villa's mapped total and a
    ₹5L completion hint (suggests constructed/coin, never forces).
    villas / txns / vtypes may be passed in (already read for every client at
    once) so a portfolio-wide summary doesn't read per client."""
    if villas is not None and txns is not None:
        villas = sorted(villas, key=lambda v: v.get("sort_order") or 0)
    elif _use_supabase():
        # the three reads at once (villas, transactions, villa types)
        from concurrent.futures import ThreadPoolExecutor

        def _types():
            try:
                from app.villa_sales import get_types
                return get_types()
            except Exception:
                return {}
        try:
            with ThreadPoolExecutor(max_workers=3) as ex:
                fv = ex.submit(lambda: _sb().table("client_villas").select("*")
                               .eq("client_code", client_code).order("sort_order").execute().data or [])
                ft = ex.submit(list_transactions, client_code)
                fy = ex.submit(_types) if vtypes is None else None
                villas, txns = fv.result(), ft.result()
                if fy is not None:
                    vtypes = fy.result()
        except Exception:
            villas, txns = [], []
    else:
        store = _load_local()
        villas = sorted([v for v in store.get("client_villas", []) if v.get("client_code") == client_code],
                        key=lambda v: v.get("sort_order", 0))
        txns = list_transactions(client_code)

    r = allocate_client(client_code, villas=villas, txns=txns)
    houses = r["houses"]
    # today's NAV for every scheme in any villa (cached, in parallel)
    codes = {l["scheme_code"] for h in houses for l in h["holdings"] if l.get("scheme_code")}
    prime_navs(codes)
    navs: dict = {c: live_nav(c)[0] for c in codes}
    if vtypes is None:
        try:
            from app.villa_sales import get_types
            vtypes = get_types()
        except Exception:
            vtypes = {}
    rows_by_id = {v["id"]: v for v in villas}
    pinned_count: dict[str, int] = {}
    for t in txns:
        if t.get("villa_id"):
            pinned_count[t["villa_id"]] = pinned_count.get(t["villa_id"], 0) + 1
    out = []
    seen = set()
    for h in houses:
        v = rows_by_id.get(h["villa_id"], {})
        seen.add(h["villa_id"])
        mapped = h["invested"]
        value = round(sum(l["units"] * navs[l["scheme_code"]] if navs.get(l.get("scheme_code")) else l["invested"]
                          for l in h["holdings"]), 2)
        out.append({
            "id": h["villa_id"], "client_code": client_code, "name": h["name"],
            "status": v.get("status") or h["status"], "coin": bool(v.get("coin")) or h["coin"],
            "sort_order": v.get("sort_order", h["order"]), "created_at": v.get("created_at"), "updated_at": v.get("updated_at"),
            "auto": h["auto"],                              # made by the rule, not an admin row
            "bucket_id": h.get("bucket"),                    # the recipe it is built from
            "villa_type": vtypes.get(h["villa_id"]),        # conservative / balanced / aggressive
            "mapped_total": mapped,
            "pinned_count": pinned_count.get(h["villa_id"], 0),
            "txn_count": len(h["holdings"]),
            "funds": h["holdings"],
            "value": value,
            "gain": round(value - mapped, 2),
            "since": h["since"],
            "finished": not h["building"],
            "position": h["position"],
            "hint": {"unit": r["unit"], "progress": h["pct"], "suggest_constructed": not h["building"]},
        })
    # admin rows the rule didn't need (no money in them) — still listed, so they can be deleted
    for v in villas:
        if v["id"] in seen:
            continue
        out.append({**v, "auto": False, "villa_type": vtypes.get(v["id"]), "mapped_total": 0.0, "pinned_count": 0,
                    "txn_count": 0, "funds": [], "value": 0.0, "gain": 0.0, "since": "", "finished": False,
                    "position": None, "hint": {"unit": r["unit"], "progress": 0, "suggest_constructed": False}})
    return out


def create_client_villa(client_code: str, name: str) -> dict:
    vid = str(uuid.uuid4())
    row = {"id": vid, "client_code": client_code, "name": name or "Villa",
           "status": "building", "coin": False, "sort_order": 0,
           "created_at": _now_iso(), "updated_at": _now_iso()}
    if _use_supabase():
        try:
            _sb().table("client_villas").insert(row).execute()
            return {**row, "mapped_total": 0, "txn_count": 0}
        except Exception:
            pass
    store = _load_local()
    store.setdefault("client_villas", []).append(row)
    _save_local(store)
    return {**row, "mapped_total": 0, "txn_count": 0}


def update_client_villa(villa_id: str, patch: dict) -> dict | None:
    allowed = {k: v for k, v in patch.items() if k in ("name", "status", "coin", "sort_order")}
    if "status" in allowed and allowed["status"] not in ("building", "constructed"):
        allowed.pop("status")
    if not allowed:
        return None
    allowed["updated_at"] = _now_iso()
    if _use_supabase():
        try:
            r = _sb().table("client_villas").update(allowed).eq("id", villa_id).execute()
            return (r.data or [None])[0]
        except Exception:
            pass
    store = _load_local()
    for v in store.get("client_villas", []):
        if v["id"] == villa_id:
            v.update(allowed)
            _save_local(store)
            return v
    return None


def delete_client_villa(villa_id: str) -> None:
    if _use_supabase():
        try:
            # unassign its transactions, then delete the villa
            _sb().table("client_transactions").update({"villa_id": None}).eq("villa_id", villa_id).execute()
            _sb().table("client_villas").delete().eq("id", villa_id).execute()
            return
        except Exception:
            pass
    store = _load_local()
    for t in store.get("transactions", []):
        if t.get("villa_id") == villa_id:
            t["villa_id"] = None
    store["client_villas"] = [v for v in store.get("client_villas", []) if v["id"] != villa_id]
    _save_local(store)


def assign_transactions(villa_id: str | None, order_ids: list[str]) -> int:
    """Set (or clear, when villa_id is None) the villa on the given transactions."""
    if not order_ids:
        return 0
    if _use_supabase():
        try:
            q = _sb().table("client_transactions").update(
                {"villa_id": villa_id, "updated_at": _now_iso()}).in_("order_id", order_ids)
            if villa_id:
                # never pin one client's transactions to another client's villa
                v = _sb().table("client_villas").select("client_code").eq("id", villa_id).limit(1).execute().data
                if not v:
                    return 0
                q = q.eq("client_code", v[0]["client_code"])
            r = q.execute()
            return len(r.data or [])
        except Exception:
            pass
    store = _load_local()
    ids = set(order_ids)
    n = 0
    for t in store.get("transactions", []):
        if t.get("order_id") in ids:
            t["villa_id"] = villa_id
            n += 1
    _save_local(store)
    return n


# ============================================================================
# MAPPING OVERVIEW (admin home) — what is NOT mapped to a villa yet
# ============================================================================
def _all_rows(table: str, columns: str) -> list[dict]:
    """Every row of a table. Supabase caps a select at 1000 rows, so page
    through it; a partial read here would silently hide unmapped transactions."""
    out: list[dict] = []
    page = 1000
    start = 0
    while True:
        got = (_sb().table(table).select(columns)
               .range(start, start + page - 1).execute().data or [])
        out += got
        if len(got) < page:
            return out
        start += page


def mapping_overview() -> dict:
    """Portfolio-wide placement health for the admin home screen.

    Villas are placed automatically by the shared rule, so a transaction needs
    the admin only when its fund is OUTSIDE every DigiVilla bucket and it isn't
    pinned by hand (the rule can't tell which villa it belongs to). Those are the
    "unmapped" lines here: totals, the clients that have them (worst first) with
    the lines listed, plus per-client counts for the row badges."""
    cols = "order_id,client_code,txn_date,scheme_name,scheme_code,kind,amount,villa_id"
    txns: list[dict] | None = None
    villas: list[dict] = []
    if _use_supabase():
        try:
            txns = _all_rows("client_transactions", cols)
            villas = _all_rows("client_villas", "id,client_code,name")
        except Exception:
            txns = None
    if txns is None:
        store = _load_local()
        txns = list(store.get("transactions", []))
        villas = list(store.get("client_villas", []))

    villa_ids = {v["id"] for v in villas}
    villas_per_client: dict[str, int] = {}
    for v in villas:
        villas_per_client[v.get("client_code")] = villas_per_client.get(v.get("client_code"), 0) + 1
    names = {c["client_code"]: (c.get("name") or "").strip() for c in _all_clients()}
    codes = _villa_codes()

    per: dict[str, dict] = {}
    for t in txns:
        code = t.get("client_code")
        if not code or code == DEMO_CODE:
            continue
        c = per.setdefault(code, {
            "client_code": code, "name": names.get(code) or code,
            "villa_count": villas_per_client.get(code, 0),
            "total": 0, "mapped": 0, "unmapped": 0, "unmapped_amount": 0.0, "txns": [],
        })
        c["total"] += 1
        placed = (t.get("villa_id") in villa_ids) or (t.get("scheme_code") in codes)
        if placed:
            c["mapped"] += 1
            continue
        c["unmapped"] += 1
        amt = float(t.get("amount") or 0)
        c["unmapped_amount"] += amt
        c["txns"].append({
            "order_id": t.get("order_id"), "txn_date": t.get("txn_date"),
            "scheme_name": t.get("scheme_name"), "kind": t.get("kind"), "amount": round(amt, 2),
        })

    affected = []
    for c in per.values():
        c["unmapped_amount"] = round(c["unmapped_amount"], 2)
        c["txns"].sort(key=lambda t: t.get("txn_date") or "", reverse=True)
        if c["unmapped"]:
            affected.append(c)
    affected.sort(key=lambda c: (-c["unmapped"], c["name"]))

    total = sum(c["total"] for c in per.values())
    unmapped = sum(c["unmapped"] for c in per.values())
    try:
        tie = holdings_consistency()
    except Exception:
        tie = {"ok": True, "off": []}
    return {
        "as_of": _now_iso(),
        "total": total, "mapped": total - unmapped, "unmapped": unmapped,
        "unmapped_amount": round(sum(c["unmapped_amount"] for c in affected), 2),
        "clients_affected": len(affected),
        "clients": affected,
        # per-client counts for every client with transactions (row badges)
        "by_client": {code: {"total": c["total"], "mapped": c["mapped"], "unmapped": c["unmapped"]}
                      for code, c in per.items()},
        # the system's own tie-out: holdings == transactions, per client
        "consistency": {"ok": tie["ok"], "off": tie["off"]},
    }


# ============================================================================
# ADD A PURCHASE BY HAND — split across the DigiVilla mix (or one fund), units
# from that day's real NAV, pinned to a villa in the same step
# ============================================================================
_REDEEM_WORDS = ("redeem", "redemption", "switch out", "switch-out", "switchout", "swp", "withdraw", "sell", "stp out", "stp-out", "transfer out")


def _signed(t: dict, field: str) -> float:
    """units / amount with money-out transactions counted as negative."""
    v = abs(_to_float(t.get(field)))
    k = (t.get("kind") or "").lower()
    return -v if any(w in k for w in _REDEEM_WORDS) else v


def _match_manual(rec: dict, manual: list[dict], taken: set) -> dict | None:
    """The hand-added purchase a report line confirms: same fund, same money
    (±0.5%), within 4 days."""
    try:
        d = datetime.strptime(str(rec.get("txn_date"))[:10], "%Y-%m-%d")
    except Exception:
        return None
    amt = abs(_to_float(rec.get("amount")))
    for m in manual:
        if m["order_id"] in taken or m.get("scheme_code") != rec.get("scheme_code"):
            continue
        try:
            md = datetime.strptime(str(m.get("txn_date"))[:10], "%Y-%m-%d")
        except Exception:
            continue
        if abs((md - d).days) <= 4 and abs(abs(_to_float(m.get("amount"))) - amt) <= max(2.0, amt * 0.005):
            return m
    return None


def _villa_mix() -> list[dict]:
    """Today's DigiVilla mix — the first SIP bucket's funds and weights (the same
    funds the client app values villas against)."""
    try:
        bs = [b for b in list_buckets() if (b.get("kind") or "sip") == "sip"]
    except Exception:
        bs = []
    for b in bs:
        funds = [f for f in b.get("funds") or [] if f.get("scheme_code") and float(f.get("target_weight") or 0) > 0]
        if funds:
            tot = sum(float(f["target_weight"]) for f in funds)
            return [{"scheme_code": int(f["scheme_code"]), "scheme_name": f.get("scheme_name") or "Fund",
                     "weight": float(f["target_weight"]) / tot} for f in funds]
    return []


_nav_hist: dict = {}


def nav_on(scheme_code: int, day: str) -> tuple[float | None, str | None]:
    """The NAV a purchase on `day` (YYYY-MM-DD) gets: that day's NAV, or the
    nearest published one before it (weekends / holidays). Full history from
    mfapi, kept for 6 hours."""
    import time as _t
    hit = _nav_hist.get(scheme_code)
    if not hit or _t.time() - hit[0] > 6 * 3600:
        try:
            r = httpx.get(f"{MFAPI}/mf/{scheme_code}", timeout=20)
            rows = []
            for p in r.json().get("data") or []:
                dd, mm, yy = p["date"].split("-")
                rows.append((f"{yy}-{mm}-{dd}", _to_float(p["nav"])))
            rows.sort()
            hit = (_t.time(), rows)
            _nav_hist[scheme_code] = hit
        except Exception:
            return None, None
    best = None
    for d, nav in hit[1]:
        if d <= day:
            best = (nav, d)
        else:
            break
    return best if best else (None, None)


def purchase_lines(day: str, amount: float, scheme_code: int | None = None) -> list[dict]:
    """How a purchase of ₹amount on `day` splits: each fund's ₹, NAV and units.
    `scheme_code` = one fund only; otherwise today's DigiVilla mix."""
    if scheme_code:
        mix = [f for f in _villa_mix() if f["scheme_code"] == scheme_code] or \
              [{"scheme_code": scheme_code, "scheme_name": _scheme_name(scheme_code), "weight": 1.0}]
        mix = [{**mix[0], "weight": 1.0}]
    else:
        mix = _villa_mix()
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(mix)))) as ex:
        navs = list(ex.map(lambda f: nav_on(f["scheme_code"], day), mix))
    out = []
    for f, (nav, nav_date) in zip(mix, navs):
        amt = round(amount * f["weight"], 2)
        out.append({**f, "amount": amt, "nav": nav, "nav_date": nav_date,
                    "units": round(amt / nav, 4) if nav else None})
    return out


def _scheme_name(code: int) -> str:
    try:
        r = httpx.get(f"{MFAPI}/mf/{code}/latest", timeout=12)
        return (r.json().get("meta") or {}).get("scheme_name") or f"Scheme {code}"
    except Exception:
        return f"Scheme {code}"


def add_purchase(client_code: str, day: str, amount: float, kind: str,
                 scheme_code: int | None, villa_id: str | None, new_villa: bool) -> dict:
    """Record a purchase by hand: one transaction per fund (order id MAN-…),
    units from that day's NAV, pinned to `villa_id` — or to a new villa when
    `new_villa`. Holdings are updated at once so the client's total is right.
    When the AMC's report later contains the same purchase, the upload absorbs
    the hand-added lines and keeps their villa."""
    lines = purchase_lines(day, amount, scheme_code)
    if not lines or any(not l["nav"] for l in lines):
        raise ValueError("Couldn't find a NAV for that date — check the date or try again.")
    if new_villa:
        existing = list_client_villas(client_code)
        villa = create_client_villa(client_code, f"Villa {len(existing) + 1}")
        villa_id = villa["id"]
    now = _now_iso()
    recs = [{
        "order_id": f"MAN-{uuid.uuid4().hex[:12].upper()}", "client_code": client_code,
        "txn_date": day, "scheme_name": l["scheme_name"], "scheme_code": l["scheme_code"],
        "folio_no": "", "kind": kind or "Lumpsum", "amount": l["amount"], "nav": l["nav"],
        "units": l["units"], "villa_id": villa_id, "report_date": day, "updated_at": now,
    } for l in lines]
    _sb().table("client_transactions").insert(recs).execute()
    rebuild_holdings([client_code])
    return {"villa_id": villa_id, "transactions": recs}


def delete_manual_transaction(order_id: str) -> bool:
    """Undo a hand-added line (MAN-… only — report lines can't be deleted)."""
    if not order_id.startswith("MAN-"):
        return False
    got = _sb().table("client_transactions").select("*").eq("order_id", order_id).limit(1).execute().data
    if not got:
        return False
    _sb().table("client_transactions").delete().eq("order_id", order_id).execute()
    rebuild_holdings([got[0]["client_code"]])
    return True


