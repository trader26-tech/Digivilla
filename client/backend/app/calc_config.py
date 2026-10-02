"""The calculators' SETTINGS — one source of truth for every number the
calculators, the Home estate and the admin's checks use.

    villas        each villa's mix: weights per benchmark series (sum to 1)
    rebalance     the parts put back to their starting split once a year, and
                  the month-end close it's done at (12 = 31 Dec, i.e. 1 January)
    income        the parts the SWP is sold from first (then the rest pro-rata)
    withdrawals   SWP on by default? lumpsum ₹/month as a share of the amount;
                  SIP income a year as a share of the value
    tax           rates, holding periods, exemption, cess, default slab
    estate        ₹ per villa, ₹/month per finished villa, plots, build stages
    flat          the Flat calculator's assumptions (stamp, registration, rent
                  growth, upkeep, vacancy, standard deduction, brokerage)
    fd            NRI TDS on NRO deposit interest
    display       inflation for "today's money"; the years behind each villa's "% a yr"

Where it lives, in order:
  1. this worker's memory (re-read at most every CACHE_S seconds),
  2. Supabase Storage  calc-data/calc_config.json   ← the LIVE copy (the admin's
     Calculator settings page and scripts/calc_config.py write here),
  3. app/data/calc_config.json in the repo            ← the default / fallback.
Every save keeps the previous version under calc-data/calc_config_history/.

Readers: the client app (GET /calc/config), the client backend itself
(villa ₹ / income on the estate), the admin (audit checks + settings page),
research/portfolio_sim.py.
"""

from __future__ import annotations

import copy
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_DEFAULT = Path(__file__).resolve().parent / "data" / "calc_config.json"
_BUCKET, _OBJECT, _HISTORY = "calc-data", "calc_config.json", "calc_config_history"
CACHE_S = 60
SERIES = ("arbitrage", "gold", "large", "mid", "small")      # what index_data serves

_MEM: dict = {"at": 0.0, "cfg": None}
_LOCK = threading.Lock()


# ─────────────────────────────── validation ───────────────────────────────
def validate(cfg: dict) -> list[str]:
    """Every problem with a settings object, in plain words ([] = fine)."""
    errs: list[str] = []

    def num(path: str, v: Any, lo: float, hi: float) -> None:
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not (lo <= v <= hi):
            errs.append(f"{path} must be a number between {lo:g} and {hi:g} (got {v!r})")

    villas = cfg.get("villas")
    if not isinstance(villas, list) or not villas:
        errs.append("villas: at least one villa is needed")
        villas = []
    keys = set()
    for i, v in enumerate(villas):
        p = f"Villa '{v.get('name') or v.get('key') or i + 1}'"
        k = v.get("key")
        if not isinstance(k, str) or not k.strip():
            errs.append(f"{p}.key is missing")
        elif k in keys:
            errs.append(f"{p}.key '{k}' is used twice")
        keys.add(k)
        if not str(v.get("name", "")).strip():
            errs.append(f"{p}.name is missing")
        if v.get("risk") not in (1, 2, 3):
            errs.append(f"{p}.risk must be 1 (low), 2 (medium) or 3 (high)")
        w = v.get("weights")
        if not isinstance(w, dict) or not w:
            errs.append(f"{p}.weights are missing")
            continue
        for s, x in w.items():
            if s not in SERIES:
                errs.append(f"{p}.weights.{s}: unknown series (use {', '.join(SERIES)})")
            num(f"{p}.weights.{s}", x, 0, 1)
        tot = sum(x for x in w.values() if isinstance(x, (int, float)))
        if abs(tot - 1) > 1e-6:
            errs.append(f"{p}: the mix adds up to {tot * 100:.4g}% — it must add up to 100%")
    if cfg.get("default_villa") not in keys:
        errs.append(f"default_villa '{cfg.get('default_villa')}' is not one of the villas")

    rb = cfg.get("rebalance") or {}
    parts = rb.get("parts")
    if not isinstance(parts, list) or any(s not in SERIES for s in parts):
        errs.append(f"rebalance.parts must be a list of series ({', '.join(SERIES)})")
    if rb.get("month") not in range(1, 13):
        errs.append("rebalance.month must be 1–12 (the month-end close it's done at; 12 = 1 January)")
    inc = cfg.get("income") or {}
    if not isinstance(inc.get("pay_first"), list) or any(s not in SERIES for s in inc.get("pay_first", [])):
        errs.append("income.pay_first must be a list of series")

    wd = cfg.get("withdrawals") or {}
    if not isinstance(wd.get("swp_default"), bool):
        errs.append("withdrawals.swp_default must be true or false")
    num("withdrawals.lumpsum_monthly_rate", wd.get("lumpsum_monthly_rate"), 0, 0.05)
    num("withdrawals.sip_yearly_rate", wd.get("sip_yearly_rate"), 0, 0.5)

    t = cfg.get("tax") or {}
    for k in ("equity_st_rate", "equity_lt_rate", "gold_lt_rate", "cess"):
        num(f"tax.{k}", t.get(k), 0, 1)
    for k in ("equity_lt_months", "gold_lt_months"):
        num(f"tax.{k}", t.get(k), 0, 120)
    num("tax.equity_exempt", t.get("equity_exempt"), 0, 1e8)
    num("tax.default_slab", t.get("default_slab"), 0, 50)
    if not isinstance(t.get("gold_parts"), list) or any(s not in SERIES for s in t.get("gold_parts", [])):
        errs.append("tax.gold_parts must be a list of series taxed like gold")

    e = cfg.get("estate") or {}
    num("estate.villa_cost", e.get("villa_cost"), 1, 1e9)
    num("estate.villa_income_monthly", e.get("villa_income_monthly"), 0, 1e7)
    num("estate.plots", e.get("plots"), 1, 9)                       # the board has art for 9 parcels
    st = e.get("stages")
    if not isinstance(st, list) or len(st) != 5:
        errs.append("estate.stages: exactly 5 stages (the board has art for five build stages)")
    else:
        prev = 0
        for i, s in enumerate(st):
            if not str(s.get("name", "")).strip():
                errs.append(f"estate.stages[{i}].name is missing")
            at = s.get("at")
            if not isinstance(at, (int, float)) or at <= prev:
                errs.append(f"estate.stages[{i}].at must be more than the stage before it")
            else:
                prev = at
        if isinstance(e.get("villa_cost"), (int, float)) and abs(prev - e["villa_cost"]) > 0.5:
            errs.append("the last estate stage must be at estate.villa_cost (that's when the villa is finished)")
    fl = cfg.get("flat") or {}
    for k, hi in (("stamp_pct", 20), ("registration_pct", 10), ("sell_brokerage_pct", 10), ("rent_rise_pct", 30),
                  ("upkeep_pct", 10), ("vacant_months", 12), ("std_deduction", 1)):
        num(f"flat.{k}", fl.get(k), 0, hi)
    num("fd.nri_tds_pct", (cfg.get("fd") or {}).get("nri_tds_pct"), 0, 50)
    num("display.inflation_pct", (cfg.get("display") or {}).get("inflation_pct"), 0, 30)
    num("display.rate_years", (cfg.get("display") or {}).get("rate_years"), 1, 40)
    return errs


# ─────────────────────────────── storage ───────────────────────────────
_SB_FACTORY = None


def use_supabase(factory) -> None:
    """Let another service (the admin) use this module with its own Supabase client."""
    global _SB_FACTORY
    _SB_FACTORY = factory


def _sb():
    if _SB_FACTORY:
        return _SB_FACTORY()
    from app.client_portfolio import _sb as sb
    return sb()


def default() -> dict:
    return json.loads(_DEFAULT.read_text())


def _read_live() -> Optional[dict]:
    """The live copy, read through a fresh signed URL (a plain download can be a
    CDN-cached copy for up to an hour after a save)."""
    try:
        import httpx
        u = _sb().storage.from_(_BUCKET).create_signed_url(_OBJECT, 60)
        r = httpx.get(u.get("signedURL") or u.get("signedUrl"), timeout=20)
        r.raise_for_status()
        cfg = r.json()
        return cfg if not validate(cfg) else None
    except Exception:
        return None


def get(fresh: bool = False) -> dict:
    """The settings in force (a copy — callers may not mutate the cache)."""
    now = time.time()
    with _LOCK:
        if fresh or _MEM["cfg"] is None or now - _MEM["at"] > CACHE_S:
            cfg = _read_live() or _MEM["cfg"] or default()
            _MEM.update(at=now, cfg=cfg)
        return copy.deepcopy(_MEM["cfg"])


def save(cfg: dict, by: str = "admin") -> dict:
    """Validate, version and publish. Raises ValueError with every problem."""
    errs = validate(cfg)
    if errs:
        raise ValueError("; ".join(errs))
    cur = get(fresh=True)
    out = copy.deepcopy(cfg)
    out["version"] = int(cur.get("version", 0)) + 1
    out["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out["updated_by"] = by
    st = _sb().storage
    try:
        st.create_bucket(_BUCKET, options={"public": False})
    except Exception:
        pass
    try:   # keep what it replaces
        st.from_(_BUCKET).upload(f"{_HISTORY}/v{cur.get('version', 0)}.json",
                                 json.dumps(cur, indent=2).encode(), {"content-type": "application/json", "upsert": "true"})
    except Exception:
        pass
    st.from_(_BUCKET).upload(_OBJECT, json.dumps(out, indent=2).encode(),
                             {"content-type": "application/json", "upsert": "true", "cache-control": "0"})
    with _LOCK:
        _MEM.update(at=time.time(), cfg=out)
    return out


def history() -> list[dict]:
    """Saved versions, newest first: [{version, name}]."""
    try:
        rows = _sb().storage.from_(_BUCKET).list(_HISTORY) or []
    except Exception:
        return []
    out = []
    for r in rows:
        n = r.get("name", "")
        if n.startswith("v") and n.endswith(".json"):
            try:
                out.append({"version": int(n[1:-5]), "name": n, "saved_at": r.get("updated_at")})
            except ValueError:
                continue
    return sorted(out, key=lambda x: -x["version"])


def load_version(version: int) -> Optional[dict]:
    try:
        import httpx
        u = _sb().storage.from_(_BUCKET).create_signed_url(f"{_HISTORY}/v{version}.json", 60)
        r = httpx.get(u.get("signedURL") or u.get("signedUrl"), timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


# ─────────────────────────────── helpers for the backend ───────────────────────────────
def villa(key: Optional[str] = None) -> dict:
    cfg = get()
    k = key or cfg["default_villa"]
    return next((v for v in cfg["villas"] if v["key"] == k), next(v for v in cfg["villas"] if v["key"] == cfg["default_villa"]))


def estate() -> dict:
    return get()["estate"]
