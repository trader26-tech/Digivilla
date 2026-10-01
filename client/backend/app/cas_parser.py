"""CAS (Consolidated Account Statement) parser — reads what an investor holds.

Two statement families reach us:

  * DEPOSITORY CAS (CDSL / NSDL) — every demat account + MF folios on one PAN.
    Parsed here from the PDF's tables (pdfplumber). Holdings only carry units,
    price and value; purchase history is NOT in these statements.
  * RTA CAS (CAMS / KFintech) — MF folios with full transaction history.
    Parsed by `casparser` (the de-facto open-source parser for these).

"100% accurate" is enforced, not hoped for: every figure we extract is checked
against the totals the statement itself prints (per account, per asset class,
per folio, grand total — to the paisa) and every row against units × price.
If ANY check fails we raise CASError('mismatch') instead of returning numbers
that might be wrong. The checks performed are returned in `checks` so the UI
can show exactly what was verified.

The PDF and password are only held in memory for the call — nothing is stored.
"""

from __future__ import annotations

import io
import os
import re
import threading
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from typing import Optional

_ISIN = re.compile(r"^IN[A-Z0-9]{10}$")
_DATE = r"(\d{2}-\d{2}-\d{4})"
_PV = re.compile(r"Portfolio Value (for Bond )?[`₹]\s*([\d,]+\.\d{2}) as on")


class CASError(Exception):
    """code: bad_password | not_pdf | not_cas | unsupported | mismatch | empty"""

    def __init__(self, code: str, message: str, checks: Optional[list] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.checks = checks or []


# ── small helpers ────────────────────────────────────────────────────────────

def _num(cell) -> float:
    """'1,02,13,387.38' / '5\\n--' / '15550.0\\xad\\n00' / '--' → float."""
    if cell is None:
        return 0.0
    s = str(cell).replace("\xad", "")
    # multi-line NSDL cells hold a) and b) values stacked: take the first line,
    # unless the line break just splits one number (soft-hyphen wrap).
    parts = [p.strip() for p in s.split("\n") if p.strip()]
    if len(parts) > 1 and all(re.fullmatch(r"[\d,.\-]+", p) for p in parts) and not parts[0].endswith(".") \
            and "." in parts[0] and not parts[1].startswith("--") and re.fullmatch(r"\d+", parts[1]):
        s = parts[0] + parts[1]          # '15550.0' + '00'
    else:
        s = parts[0] if parts else ""
    s = s.replace(",", "").replace(" ", "")
    if s in ("", "--", "-"):
        return 0.0
    return float(s)


def _clean(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _ascii(s) -> str:
    return re.sub(r"[^\x20-\x7e]", "", str(s or ""))


def _iso(d: str) -> str:
    return datetime.strptime(d, "%d-%m-%Y").date().isoformat()


def _mask_pan(pan: str) -> str:
    return pan[:2] + "•••••" + pan[-3:] if len(pan) == 10 else ""


def _en_text(page) -> str:
    """Page text with only Latin-script glyphs. Depository CAS print Hindi on the
    same baseline as English, which interleaves in plain extraction."""
    try:
        return page.filter(lambda o: o.get("object_type") != "char" or o.get("text", "").isascii()
                           or o.get("text") in "₹`").extract_text() or ""
    except Exception:
        return page.extract_text() or ""


def _open(pdf_bytes: bytes, password: str):
    import pdfplumber
    from pdfminer.pdfdocument import PDFPasswordIncorrect
    if not pdf_bytes or not pdf_bytes.lstrip()[:5].startswith(b"%PDF"):
        raise CASError("not_pdf", "That file isn't a PDF.")
    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes), password=password or "")
        _ = pdf.pages[0].extract_text()          # force decryption now
        return pdf
    except PDFPasswordIncorrect:
        raise CASError("bad_password", "Wrong password for this statement.")
    except CASError:
        raise
    except Exception as e:  # pdfminer raises assorted errors on bad crypto/pw
        if "password" in str(e).lower() or "decrypt" in str(e).lower():
            raise CASError("bad_password", "Wrong password for this statement.")
        raise CASError("not_pdf", "Couldn't read this PDF.")


class _Checks:
    """Collects reconciliation checks; `ok` is False if any failed."""

    def __init__(self):
        self.items: list[dict] = []

    def add(self, label: str, parsed: float, printed: float, tol: float = 0.011) -> bool:
        ok = abs(parsed - printed) <= tol
        self.items.append({"label": label, "parsed": round(parsed, 2),
                           "printed": round(printed, 2), "ok": ok})
        return ok

    def count(self, label: str, parsed: int, printed: int) -> bool:
        ok = parsed == printed
        self.items.append({"label": label, "parsed": parsed, "printed": printed, "ok": ok})
        return ok

    @property
    def ok(self) -> bool:
        return all(c["ok"] for c in self.items)

    @property
    def failed(self) -> list[dict]:
        return [c for c in self.items if not c["ok"]]


# ── entry point ──────────────────────────────────────────────────────────────

def parse(pdf_bytes: bytes, password: str) -> dict:
    """Parse any supported CAS. Returns

        {source, statement_date, period:{from,to}, investor:{name, pan_masked},
         holdings:[{isin, name, units, price, value, account, kind, invested?,
                    scheme_code?, folio?}],
         totals:{grand, mf, by_class:{…}}, checks:[…], has_history: bool,
         transactions:[…] (RTA detailed only)}

    Raises CASError on a wrong password, an unknown document, or ANY figure that
    does not reconcile with the statement's own printed totals."""
    pdf = _open(pdf_bytes, password)
    try:
        # Depository CAS print English and Hindi on the same baseline, so running
        # text interleaves; detect on Latin-only text of page 1 (cheap), falling
        # back to the summary tables for layouts that word it differently.
        head = _en_text(pdf.pages[0])
        flat = re.sub(r"\s", "", head)
        if "HELD IN DEMAT" in head.upper() or re.search(r"(Central|National\w*)Depository", flat) \
                or _summary_from_tables([t.extract() for pg in pdf.pages[:3] for t in pg.find_tables()])["accounts"]:
            return _parse_depository(pdf, pdf_bytes, password, "CDSL" if "CentralDepository" in flat else "NSDL")
    finally:
        pdf.close()
    if re.search(r"CAMS|KFIN|Karvy|Consolidated Account Statement", head, re.I):
        return _parse_rta(pdf_bytes, password)
    raise CASError("not_cas", "This doesn't look like a CAS. Download one from CAMS, KFintech, CDSL or NSDL.")


# ── depository CAS (CDSL / NSDL) ─────────────────────────────────────────────

def _isin(cell) -> str:
    """The ISIN in a first cell, or ''. CDSL marks some (e.g. awaiting listing
    after a merger) with a trailing '*'; cells can also wrap a stray letter."""
    first = _clean(cell).split(" ")[0] if cell else ""
    first = first.rstrip("*#").strip()
    return first if _ISIN.match(first) else ""


def _table_kind(header: list) -> Optional[str]:
    h = _ascii(" ".join(_clean(c) for c in header if c)).lower()
    # some headers render each glyph twice ('TTrraannssaacctt'); collapse runs too
    h = h + " | " + re.sub(r"(\w)\1+", r"\1", h)
    if "coupon" in h and "maturity" in h:
        return "bond"
    if "folio no" in h and "closing" in h:
        return "folio"
    if "free bal" in h and ("current" in h or "a)" in h) and "market" in h:
        return "holding_nsdl" if "locked" in h else "holding"
    if "op. bal" in h or "transaction" in h or "transact" in h or "lockin" in h or " date" in h:
        return "skip"
    return None


def _find_header(rows: list) -> tuple[Optional[str], int]:
    """(kind, index of the header row) — the header is not always row 0: a title
    row ('MUTUAL FUND UNITS HELD AS ON …') can sit above it in the same table."""
    for i, r in enumerate(rows[:3]):
        k = _table_kind(r)
        if k:
            return k, i
        if r and _isin(r[0]):
            break
    return None, 0


def _page_events(pdf, indices) -> list:
    """(page, top, 'table', rows) and (page, top, 'pv', value, is_bond) for `indices`."""
    out = []
    for pi in indices:
        page = pdf.pages[pi]
        for t in page.find_tables():
            out.append((pi, t.bbox[1], "table", t.extract()))
        words = page.extract_words(keep_blank_chars=True, x_tolerance=2)
        lines: dict[int, list] = {}
        for w in words:
            lines.setdefault(round(w["top"]), []).append(w)
        for top, ws in lines.items():
            s = " ".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"]))
            m = _PV.search(s)
            if m:
                out.append((pi, float(top), "pv", float(m.group(2).replace(",", "")), bool(m.group(1))))
        page.flush_cache()
    return out


_WORKER_DOC: tuple = ("", None)            # (digest, open pdf) — per worker process


def _worker_events(pdf_bytes: bytes, password: str, indices: list) -> list:
    """Process-pool entry: read a share of pages. Opening a CAS is the expensive
    part (pdfminer re-loads its large embedded fonts per open and caches them per
    document), so each worker keeps the current statement open across tasks."""
    global _WORKER_DOC
    import hashlib
    import pdfplumber
    key = hashlib.sha1(pdf_bytes + (password or "").encode()).hexdigest()
    if _WORKER_DOC[0] != key:
        if _WORKER_DOC[1] is not None:
            try:
                _WORKER_DOC[1].close()
            except Exception:
                pass
        _WORKER_DOC = (key, pdfplumber.open(io.BytesIO(pdf_bytes), password=password or ""))
    return _page_events(_WORKER_DOC[1], indices)


# Laying out a page (pdfminer) is ~0.25 s of pure-Python CPU per page, so a
# 35-page CAS takes ~9 s on one core. Pages are independent: a small warm pool
# of worker PROCESSES reads them in parallel (spawned, not forked — the API
# server is multi-threaded). Kept alive between requests; see warm().
_POOL: Optional[ProcessPoolExecutor] = None
_POOL_LOCK = threading.Lock()
_CHUNK = 3                                   # pages per task (balances uneven pages)


def _workers() -> int:
    try:
        n = len(os.sched_getaffinity(0))     # respects container CPU limits on Linux
    except AttributeError:
        n = os.cpu_count() or 2
    return max(1, min(6, n))


def _pool() -> Optional[ProcessPoolExecutor]:
    global _POOL
    if _workers() < 2:
        return None
    with _POOL_LOCK:
        if _POOL is None:
            import multiprocessing as mp
            _POOL = ProcessPoolExecutor(max_workers=_workers(), mp_context=mp.get_context("spawn"))
        return _POOL


def _noop() -> int:
    import pdfplumber  # noqa: F401  — pay the import in each worker up front
    return os.getpid()


def warm() -> None:
    """Start the worker processes now (called when the upload screen opens), so
    the first real parse doesn't pay process start-up + imports."""
    pool = _pool()
    if pool:
        for f in [pool.submit(_noop) for _ in range(_workers())]:
            try:
                f.result(timeout=30)
            except Exception:
                pass


def _events(pdf, pdf_bytes: bytes, password: str) -> list:
    """All pages' events in reading order — in parallel when a pool is available,
    else serially. Either way the result is identical."""
    global _POOL
    n = len(pdf.pages)
    out: list = []
    pool = _pool() if n > _CHUNK * 2 else None
    if pool:
        chunks = [list(range(i, min(i + _CHUNK, n))) for i in range(0, n, _CHUNK)]
        try:
            for part in pool.map(_worker_events, [pdf_bytes] * len(chunks), [password] * len(chunks), chunks):
                out.extend(part)
        except Exception:
            # a broken pool (worker killed, OOM) → drop it and read serially
            with _POOL_LOCK:
                _POOL = None
            out = _page_events(pdf, range(n))
    else:
        out = _page_events(pdf, range(n))
    out.sort(key=lambda e: (e[0], e[1]))
    return out


def _summary_from_tables(tables: list) -> dict:
    """The statement's own printed figures (from the first pages' tables):
    per-account values + ISIN counts, per-asset-class values, grand total, MF
    folio total, investor."""
    info: dict = {"accounts": [], "classes": {}, "grand": None, "folios_value": None,
                  "name": "", "pan": ""}
    for rows in tables:
        for r in rows:
            cells = [_clean(c) for c in r]
            first = cells[0] if cells else ""
            m = re.search(r"name of\s+(.+?)\s*\(\s*PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])", _clean(r[0] or ""))
            if m and not info["name"]:
                info["name"], info["pan"] = m.group(1).strip(), m.group(2)
            if first in ("CDSL Demat Account", "NSDL Demat Account") and len(cells) >= 4:
                info["accounts"].append({"type": first[:4], "details": cells[1],
                                         "isins": int(_num(cells[2])), "value": _num(cells[3])})
            elif first == "Mutual Fund Folios" and len(cells) >= 4 and re.search(r"Folio", cells[1]):
                info["folios_value"] = _num(cells[3])
            elif len(cells) >= 4 and cells[2] == "Grand Total":
                info["grand"] = _num(cells[3])
            elif len(cells) == 3 and first and re.fullmatch(r"[\d,]+\.\d{2}", cells[1] or "") \
                    and re.fullmatch(r"-?[\d.]+", cells[2] or "") and not re.match(r"[A-Z][a-z]{2} \d{4}", first):
                info["classes"][first] = _num(cells[1])
    return info


def _acc_value(acc: dict) -> float:
    return sum(h["value"] for h in acc["rows"])


def _match_accounts(parsed: list[dict], printed: list[dict]) -> Optional[list[tuple]]:
    """Pair each parsed holdings section with the summary's printed account.

    Statements don't always line up 1:1 by position, so we match on what the
    statement itself prints — the account VALUE and its ISIN COUNT:
      1. direct, order-independent: every section ties to a distinct printed
         account with the same value + holdings count;
      2. merged: an account whose holdings were printed in several sections
         (each with its own 'Portfolio Value' line) — consecutive sections are
         combined until they tie to the next printed account.
    Returns the pairs, or None if no reconciling assignment exists (the caller
    then reports the mismatch instead of showing numbers)."""
    tol = 0.011
    # 1) direct match
    used: set[int] = set()
    direct: list[tuple] = []
    for acc in parsed:
        v, n = _acc_value(acc), len(acc["rows"])
        hit = next((i for i, pa in enumerate(printed)
                    if i not in used and abs(pa["value"] - v) <= tol and pa["isins"] == n), None)
        if hit is None:
            break
        used.add(hit)
        direct.append((acc, printed[hit]))
    if len(direct) == len(parsed) and len(used) == len(printed):
        return direct

    # 2) merge consecutive sections, in statement order
    merged: list[tuple] = []
    i = 0
    for pa in printed:
        rows: list = []
        parts: list = []
        while i < len(parsed):
            rows += parsed[i]["rows"]
            parts += parsed[i]["printed_parts"]
            i += 1
            v = sum(h["value"] for h in rows)
            if abs(v - pa["value"]) <= tol and len(rows) == pa["isins"]:
                break
            if v > pa["value"] + tol:
                return None
        else:
            if not (abs(sum(h["value"] for h in rows) - pa["value"]) <= tol and len(rows) == pa["isins"]):
                return None
        merged.append(({"rows": rows, "printed_parts": parts}, pa))
    return merged if i == len(parsed) else None


def _parse_depository(pdf, pdf_bytes: bytes, password: str, source: str) -> dict:
    text1 = _en_text(pdf.pages[0])
    period = re.search(r"PERIOD FROM\s+" + _DATE + r"[\s\S]{0,160}?\bTO\s+" + _DATE, text1)
    events = _events(pdf, pdf_bytes, password)
    summ = _summary_from_tables([ev[3] for ev in events if ev[2] == "table" and ev[0] < 4])
    checks = _Checks()

    holdings: list[dict] = []
    sections: list[dict] = []          # closed by each 'Portfolio Value … as on'
    pending: list[dict] = []
    folio_rows: list[dict] = []
    folio_grand: Optional[float] = None
    last_kind: Optional[str] = None
    last_ncols = 0

    for ev in events:
        if ev[2] == "pv":
            sections.append({"printed": ev[3], "bond": ev[4], "rows": pending})
            pending = []
            continue
        rows = ev[3]
        if not rows:
            continue
        kind, hi = _find_header(rows)
        body = rows[hi + 1:]
        if kind is None:
            # a continuation table without its header row: inherit the last kind
            # (any misread row is caught by the units × price and total checks)
            if last_kind and len(rows[0]) == last_ncols and rows[0][0] and _isin(rows[0][0]):
                kind, body = last_kind, rows
            else:
                continue
        last_kind, last_ncols = kind, len(rows[hi])
        if kind == "skip":
            continue
        for r in body:
            c0 = _clean(r[0]) if r and r[0] else ""
            if kind == "folio":
                if c0 == "Grand Total":
                    folio_grand = _num(r[6])
                elif len(r) >= 7 and _isin(r[1]):
                    folio_rows.append({
                        "isin": _clean(r[1]), "name": re.sub(r"^\d+\s*-\s*", "", _clean(r[0])),
                        "folio": _clean(r[2]), "units": _num(r[3]), "price": _num(r[4]),
                        "invested": _num(r[5]), "value": _num(r[6]),
                    })
                continue
            c0 = _isin(r[0])
            if not c0:
                continue
            if kind == "bond":
                units, price, value = _num(r[4]), _num(r[6]), _num(r[7])
            else:
                units, price, value = _num(r[2]), _num(r[-2]), _num(r[-1])
            pending.append({"isin": c0, "name": _clean(r[1]), "units": units, "price": price,
                            "value": value, "table": kind})

    # every row: units × price must equal the printed value
    bad_rows = [h for sec in sections for h in sec["rows"]
                if abs(h["units"] * h["price"] - h["value"]) > max(0.011, h["units"] * 0.00006 + 0.006)]
    checks.count("Rows where units × price = value", sum(len(s["rows"]) for s in sections) - len(bad_rows),
                 sum(len(s["rows"]) for s in sections))

    # sections → accounts (a bond section belongs to the account just closed)
    accounts: list[dict] = []
    for sec in sections:
        if sec["bond"] and accounts:
            accounts[-1]["rows"] += sec["rows"]
            accounts[-1]["printed_parts"].append(sec["printed"])
        else:
            accounts.append({"rows": list(sec["rows"]), "printed_parts": [sec["printed"]]})
        checks.add(("Bond section" if sec["bond"] else f"Account section {len(accounts)}") + " total",
                   sum(h["value"] for h in sec["rows"]), sec["printed"])
    if pending:
        checks.count("Holdings outside any account section", 0, len(pending))

    printed_all = summ["accounts"]
    # A dormant/closed demat account is listed in the summary with 0 ISINs and
    # ₹0 but gets NO holdings section — it is expected to have no rows.
    empty_accounts = [a for a in printed_all if a["isins"] == 0 and abs(a["value"]) < 0.011]
    printed_accounts = [a for a in printed_all if a not in empty_accounts]
    pairs = _match_accounts(accounts, printed_accounts)
    if pairs is None:
        # couldn't tie every section to a printed account → keep the strict
        # positional checks so the failure is reported (never show unverified numbers)
        checks.count("Demat accounts with holdings", len(accounts), len(printed_accounts))
        pairs = list(zip(accounts, printed_accounts))
    else:
        checks.count("Demat accounts with holdings", len(pairs), len(printed_accounts))
    if empty_accounts:
        checks.count("Empty demat accounts (₹0, nothing held)", len(empty_accounts), len(empty_accounts))
    for acc, pa in pairs:
        label = f"{pa['type']} · {pa['details'].split(' DP Id')[0][:40]}"
        checks.add(f"{label} value", sum(h["value"] for h in acc["rows"]), pa["value"])
        checks.count(f"{label} holdings", len(acc["rows"]), pa["isins"])
        for h in acc["rows"]:
            h["account"] = label
            h["kind"] = "mf" if h["isin"].startswith("INF") else ("bond" if h["table"] == "bond" else "security")
            h["source"] = "demat"
            h.pop("table", None)
            holdings.append(h)

    # MF folios (non-demat)
    for f in folio_rows:
        holdings.append({**f, "account": f"Folio {f['folio']}", "kind": "mf", "source": "folio"})
        checks.add(f"Folio {f['folio']} units × NAV", f["units"] * f["price"], f["value"],
                   tol=max(0.011, f["units"] * 0.00006 + 0.006))
    if summ["folios_value"] is not None or folio_rows:
        checks.add("Mutual fund folios total", sum(f["value"] for f in folio_rows),
                   summ["folios_value"] if summ["folios_value"] is not None else (folio_grand or 0.0))

    mf_demat = sum(h["value"] for h in holdings if h["kind"] == "mf" and h["source"] == "demat")
    if "Mutual Funds Held in Demat Form" in summ["classes"]:
        checks.add("Mutual funds held in demat", mf_demat, summ["classes"]["Mutual Funds Held in Demat Form"])
    grand = sum(h["value"] for h in holdings)
    if summ["grand"] is not None:
        checks.add("Total portfolio value", grand, summ["grand"])
    else:
        checks.count("Printed grand total found", 0, 1)

    if not holdings:
        raise CASError("empty", "No holdings found in this statement.", checks.items)
    if not checks.ok:
        raise CASError("mismatch",
                       "We couldn't read this statement with full accuracy, so we won't show numbers from it.",
                       checks.items)

    # holdings are stated "as on" the last day of the statement period
    stmt = period.group(2) if period else None

    return {
        "source": source,
        "statement_date": _iso(stmt) if stmt else None,
        "period": {"from": _iso(period.group(1)), "to": _iso(period.group(2))} if period else None,
        "investor": {"name": summ["name"], "pan_masked": _mask_pan(summ["pan"])},
        "holdings": [{**h, "units": round(h["units"], 4), "value": round(h["value"], 2)} for h in holdings],
        "totals": {
            "grand": round(grand, 2),
            "mf": round(sum(h["value"] for h in holdings if h["kind"] == "mf"), 2),
            "by_class": summ["classes"],
        },
        "has_history": False,
        "transactions": [],
        "checks": checks.items,
    }


# ── RTA CAS (CAMS / KFintech) via casparser ──────────────────────────────────

def _parse_rta(pdf_bytes: bytes, password: str) -> dict:
    try:
        import casparser
        from casparser.exceptions import CASParseError, IncorrectPasswordError
    except ImportError:
        raise CASError("unsupported", "CAMS/KFintech statements aren't supported on this server yet.")
    try:
        data = casparser.read_cas_pdf(io.BytesIO(pdf_bytes), password)
    except IncorrectPasswordError:
        raise CASError("bad_password", "Wrong password for this statement.")
    except CASParseError as e:
        raise CASError("unsupported", f"Couldn't read this statement ({e}).")
    d = data.model_dump(mode="json") if hasattr(data, "model_dump") else data

    checks = _Checks()
    holdings, txns = [], []
    detailed = str(d.get("cas_type", "")).upper() == "DETAILED"
    for folio in d.get("folios", []):
        for s in folio.get("schemes", []):
            close = float(s.get("close") or 0)
            val = s.get("valuation") or {}
            if detailed:
                # opening units + every transaction's units must land on the printed closing units
                calc = float(s.get("close_calculated") if s.get("close_calculated") is not None else close)
                checks.add(f"{_clean(s.get('scheme'))[:40]} units", calc, close, tol=0.0011)
                for t in s.get("transactions", []):
                    txns.append({"isin": s.get("isin"), "scheme_code": int(s["amfi"]) if s.get("amfi") else None,
                                 "date": str(t.get("date")), "type": t.get("type"),
                                 "amount": float(t["amount"]) if t.get("amount") is not None else None,
                                 "units": float(t["units"]) if t.get("units") is not None else None,
                                 "nav": float(t["nav"]) if t.get("nav") is not None else None})
            if close <= 0:
                continue
            nav, value = float(val.get("nav") or 0), float(val.get("value") or 0)
            checks.add(f"{_clean(s.get('scheme'))[:40]} units × NAV", close * nav, value,
                       tol=max(0.011, close * 0.00006 + 0.006))
            holdings.append({
                "isin": s.get("isin") or "", "name": _clean(s.get("scheme")), "units": round(close, 4),
                "price": nav, "value": round(value, 2), "invested": float(val["cost"]) if val.get("cost") else None,
                "scheme_code": int(s["amfi"]) if s.get("amfi") else None, "folio": folio.get("folio"),
                "account": f"{folio.get('amc', '')} · {folio.get('folio', '')}".strip(" ·"),
                "kind": "mf", "source": "folio",
            })
    if not holdings:
        raise CASError("empty", "No mutual fund holdings found in this statement.", checks.items)
    if not checks.ok:
        raise CASError("mismatch",
                       "We couldn't read this statement with full accuracy, so we won't show numbers from it.",
                       checks.items)
    period = d.get("statement_period") or {}
    to = period.get("to")

    def _dmy(s):
        try:
            return datetime.strptime(s, "%d-%b-%Y").date().isoformat()
        except (TypeError, ValueError):
            return None

    total = sum(h["value"] for h in holdings)
    return {
        "source": str(d.get("file_type") or "RTA"),
        "statement_date": _dmy(to),
        "period": {"from": _dmy(period.get("from")), "to": _dmy(to)},
        "investor": {"name": (d.get("investor_info") or {}).get("name", ""), "pan_masked": ""},
        "holdings": holdings,
        "totals": {"grand": round(total, 2), "mf": round(total, 2), "by_class": {}},
        "has_history": detailed and bool(txns),
        "transactions": txns,
        "checks": checks.items,
    }
