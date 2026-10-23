"""Every index the admin can add to a mix of their own on Markets today ("Your mix").

The board (app.india) carries a fixed set; this module serves ANY of the catalogue below, on
demand, for the same ranges:

  NSE indices      daily TOTAL-RETURN closes from niftyindices.com (April 2010 →), the same
                   source as the stored villa indices, so a mix of them is like for like;
                   today's move from NSE's own live board; 1D / 1W bars from Yahoo where Yahoo
                   carries the index, else a straight line to NSE's live move
  everything else  Yahoo (price, in the market's own currency): BSE, world indices, silver,
                   US$ gold, crude, bitcoin

NSE history is kept in memory (6 h), in Supabase Storage (calc-data/extra/<key>.json) and topped
up from the last stored day, so only the first ever pull of an index fetches 15+ years.
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Optional

import httpx

from app import market as market_svc

_G_BROAD, _G_SIZE, _G_SECTOR, _G_THEME, _G_STRAT, _G_COMMOD, _G_WORLD = (
    "Broad market", "Size", "Sectors", "Themes", "Strategy", "Commodities", "World")


def _n(key, name, short, group, nifty, symbol=None, about=""):
    return {"key": key, "name": name, "short": short, "group": group, "kind": "index", "nifty": nifty, "symbol": symbol, "about": about or name}


def _y(key, name, short, group, symbol, kind="us", about=""):
    return {"key": key, "name": name, "short": short, "group": group, "kind": kind, "nifty": None, "symbol": symbol, "about": about or name}


# the board's own items (nifty50, n100, mid, small, n500, gold, arbitrage, rupee, sp500) are listed
# too, so the picker shows everything in one place — the frontend takes those from the board
BOARD_KEYS = {"nifty50", "n100", "mid", "small", "n500", "gold", "arbitrage", "rupee", "sp500"}
CATALOG: list[dict] = [
    _n("nifty50", "Nifty 50", "Nifty 50", _G_BROAD, "NIFTY 50", "^NSEI"),
    _n("next50", "Nifty Next 50", "Next 50", _G_BROAD, "NIFTY NEXT 50", "^NSMIDCP", "Companies ranked 51–100"),
    _n("n100", "Nifty 100", "Large cap", _G_BROAD, "NIFTY 100", "^CNX100", "The 100 largest companies"),
    _n("n200", "Nifty 200", "Nifty 200", _G_BROAD, "NIFTY 200", "^CNX200"),
    _n("n500", "Nifty 500", "Nifty 500", _G_BROAD, "NIFTY 500", "^CRSLDX"),
    _n("lm250", "Nifty LargeMidcap 250", "LargeMid 250", _G_BROAD, "NIFTY LARGEMIDCAP 250", None, "Nifty 100 + Midcap 150"),
    _n("mc502525", "Nifty 500 Multicap 50:25:25", "Multicap 50:25:25", _G_BROAD, "NIFTY500 MULTICAP 50:25:25", None, "50% large, 25% mid, 25% small"),
    _n("total", "Nifty Total Market", "Total market", _G_BROAD, "NIFTY TOTAL MARKET", None, "About 750 companies"),
    _y("sensex", "BSE Sensex", "Sensex", _G_BROAD, "^BSESN", "index", "BSE's 30 largest (price index)"),
    _y("bse500", "BSE 500", "BSE 500", _G_BROAD, "BSE-500.BO", "index", "BSE's 500 largest (price index)"),

    _n("mid50", "Nifty Midcap 50", "Midcap 50", _G_SIZE, "NIFTY MIDCAP 50", "^NSEMDCP50"),
    _n("mid100", "Nifty Midcap 100", "Midcap 100", _G_SIZE, "NIFTY MIDCAP 100"),
    _n("mid", "Nifty Midcap 150", "Mid cap", _G_SIZE, "NIFTY MIDCAP 150", "NIFTYMIDCAP150.NS", "Companies ranked 101–250"),
    _n("small50", "Nifty Smallcap 50", "Smallcap 50", _G_SIZE, "NIFTY SMALLCAP 50"),
    _n("small100", "Nifty Smallcap 100", "Smallcap 100", _G_SIZE, "NIFTY SMALLCAP 100"),
    _n("small", "Nifty Smallcap 250", "Small cap", _G_SIZE, "NIFTY SMALLCAP 250", "NIFTYSMLCAP250.NS", "Companies ranked 251–500"),
    _n("micro250", "Nifty Microcap 250", "Microcap 250", _G_SIZE, "NIFTY MICROCAP 250", None, "Companies ranked 501–750"),

    _n("bank", "Nifty Bank", "Bank", _G_SECTOR, "NIFTY BANK", "^NSEBANK"),
    _n("pvtbank", "Nifty Private Bank", "Private bank", _G_SECTOR, "NIFTY PRIVATE BANK"),
    _n("psubank", "Nifty PSU Bank", "PSU bank", _G_SECTOR, "NIFTY PSU BANK", "^CNXPSUBANK"),
    _n("finsvc", "Nifty Financial Services", "Financials", _G_SECTOR, "NIFTY FINANCIAL SERVICES", "NIFTY_FIN_SERVICE.NS"),
    _n("it", "Nifty IT", "IT", _G_SECTOR, "NIFTY IT", "^CNXIT"),
    _n("pharma", "Nifty Pharma", "Pharma", _G_SECTOR, "NIFTY PHARMA", "^CNXPHARMA"),
    _n("health", "Nifty Healthcare", "Healthcare", _G_SECTOR, "NIFTY HEALTHCARE"),
    _n("auto", "Nifty Auto", "Auto", _G_SECTOR, "NIFTY AUTO", "^CNXAUTO"),
    _n("fmcg", "Nifty FMCG", "FMCG", _G_SECTOR, "NIFTY FMCG", "^CNXFMCG"),
    _n("metal", "Nifty Metal", "Metal", _G_SECTOR, "NIFTY METAL", "^CNXMETAL"),
    _n("realty", "Nifty Realty", "Realty", _G_SECTOR, "NIFTY REALTY", "^CNXREALTY"),
    _n("energy", "Nifty Energy", "Energy", _G_SECTOR, "NIFTY ENERGY", "^CNXENERGY"),
    _n("oilgas", "Nifty Oil & Gas", "Oil & gas", _G_SECTOR, "NIFTY OIL & GAS"),
    _n("infra", "Nifty Infrastructure", "Infra", _G_SECTOR, "NIFTY INFRASTRUCTURE", "^CNXINFRA"),
    _n("media", "Nifty Media", "Media", _G_SECTOR, "NIFTY MEDIA"),
    _n("durables", "Nifty Consumer Durables", "Durables", _G_SECTOR, "NIFTY CONSUMER DURABLES"),
    _n("chem", "Nifty Chemicals", "Chemicals", _G_SECTOR, "NIFTY CHEMICALS"),

    _n("consum", "Nifty India Consumption", "Consumption", _G_THEME, "NIFTY INDIA CONSUMPTION", "^CNXCONSUM"),
    _n("mnc", "Nifty MNC", "MNC", _G_THEME, "NIFTY MNC", "^CNXMNC"),
    _n("pse", "Nifty PSE", "PSE", _G_THEME, "NIFTY PSE", "^CNXPSE", "Public-sector companies"),
    _n("cpse", "Nifty CPSE", "CPSE", _G_THEME, "NIFTY CPSE"),
    _n("defence", "Nifty India Defence", "Defence", _G_THEME, "NIFTY INDIA DEFENCE"),
    _n("mfg", "Nifty India Manufacturing", "Manufacturing", _G_THEME, "NIFTY INDIA MANUFACTURING"),
    _n("digital", "Nifty India Digital", "Digital", _G_THEME, "NIFTY INDIA DIGITAL"),
    _n("housing", "Nifty Housing", "Housing", _G_THEME, "NIFTY HOUSING"),
    _n("tourism", "Nifty India Tourism", "Tourism", _G_THEME, "NIFTY INDIA TOURISM"),
    _n("commod", "Nifty Commodities", "Commodities idx", _G_THEME, "NIFTY COMMODITIES"),
    _n("services", "Nifty Services Sector", "Services", _G_THEME, "NIFTY SERVICES SECTOR"),

    _n("mom30", "Nifty200 Momentum 30", "Momentum 30", _G_STRAT, "NIFTY200 MOMENTUM 30"),
    _n("qual30", "Nifty200 Quality 30", "Quality 30", _G_STRAT, "NIFTY200 QUALITY 30"),
    _n("lowvol30", "Nifty100 Low Volatility 30", "Low vol 30", _G_STRAT, "NIFTY100 LOW VOLATILITY 30"),
    _n("alpha50", "Nifty Alpha 50", "Alpha 50", _G_STRAT, "NIFTY ALPHA 50"),
    _n("value20", "Nifty50 Value 20", "Value 20", _G_STRAT, "NIFTY50 VALUE 20"),
    _n("n50eq", "Nifty50 Equal Weight", "Nifty 50 equal", _G_STRAT, "NIFTY50 EQUAL WEIGHT"),
    _n("n500eq", "Nifty500 Equal Weight", "Nifty 500 equal", _G_STRAT, "NIFTY500 EQUAL WEIGHT"),
    _n("arbitrage", "Nifty 50 Arbitrage", "Arbitrage", _G_STRAT, "NIFTY 50 ARBITRAGE"),

    _y("gold", "Gold BeES", "Gold", _G_COMMOD, "GOLDBEES.NS", "gold", "Gold in ₹ (Nippon Gold BeES)"),
    _y("silver", "Silver BeES", "Silver", _G_COMMOD, "SILVERBEES.NS", "gold", "Silver in ₹ (Nippon Silver BeES)"),
    _y("goldusd", "Gold (US$)", "Gold US$", _G_COMMOD, "GC=F", "us", "Gold futures, US$ an ounce"),
    _y("crude", "Crude oil (WTI)", "Crude", _G_COMMOD, "CL=F", "us", "WTI crude futures, US$ a barrel"),

    _y("rupee", "Rupee vs US$", "Rupee", _G_WORLD, "INR=X", "fx"),
    _y("sp500", "S&P 500", "S&P 500", _G_WORLD, "^GSPC"),
    _y("nasdaq", "Nasdaq Composite", "Nasdaq", _G_WORLD, "^IXIC"),
    _y("dow", "Dow Jones", "Dow", _G_WORLD, "^DJI"),
    _y("ftse", "FTSE 100", "FTSE 100", _G_WORLD, "^FTSE"),
    _y("dax", "DAX", "DAX", _G_WORLD, "^GDAXI"),
    _y("stoxx", "Euro Stoxx 50", "Euro Stoxx", _G_WORLD, "^STOXX50E"),
    _y("nikkei", "Nikkei 225", "Nikkei", _G_WORLD, "^N225"),
    _y("hsi", "Hang Seng", "Hang Seng", _G_WORLD, "^HSI"),
    _y("shanghai", "Shanghai Composite", "Shanghai", _G_WORLD, "000001.SS"),
    _y("btc", "Bitcoin (US$)", "Bitcoin", _G_WORLD, "BTC-USD"),
]
BY_KEY = {c["key"]: c for c in CATALOG}
_START = date(2010, 4, 1)


def catalogue() -> list[dict]:
    return [{k: c[k] for k in ("key", "name", "short", "group", "kind", "about")} | {"source": "tri" if c["nifty"] else "price"}
            for c in CATALOG]


# ─────────────────────────────── NSE history (total return) ───────────────────────────────
_MEM: dict[str, tuple[float, dict[str, float]]] = {}
_LOCKS: dict[str, threading.Lock] = {}
_GLOCK = threading.Lock()


def _obj(key: str) -> str:
    return f"extra/{key}.json"


def _load(key: str) -> dict[str, float]:
    try:
        u = market_svc._sb().storage.from_(market_svc._BUCKET).create_signed_url(_obj(key), 60)
        r = httpx.get(u.get("signedURL") or u.get("signedUrl"), timeout=20)
        r.raise_for_status()
        return {d: float(v) for d, v in r.json().items()}
    except Exception:
        return {}


def _save(key: str, h: dict[str, float]) -> None:
    try:
        market_svc._sb().storage.from_(market_svc._BUCKET).upload(
            _obj(key), json.dumps(h, separators=(",", ":")).encode(),
            {"content-type": "application/json", "upsert": "true", "cache-control": "0"})
    except Exception:
        pass


def nse_history(key: str) -> dict[str, float]:
    """{day: total-return close} since April 2010 for a catalogue NSE index."""
    c = BY_KEY.get(key)
    if not c or not c["nifty"]:
        return {}
    hit = _MEM.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    with _GLOCK:
        lock = _LOCKS.setdefault(key, threading.Lock())
    with lock:
        hit = _MEM.get(key)
        if hit and time.time() - hit[0] < 6 * 3600:
            return hit[1]
        h = dict(hit[1]) if hit else _load(key)
        today = date.today()
        first = (date.fromisoformat(max(h)) - timedelta(days=10)) if h else _START
        if first <= today:
            try:
                s = market_svc._nifty_session()
                try:
                    got = market_svc._nifty(s, {"nifty": c["nifty"], "kind": "tri"}, first, today)
                finally:
                    s.close()
                if got:
                    before = len(h)
                    h.update(got)
                    if len(h) != before or not hit:
                        _save(key, h)
            except Exception:
                pass
        if h:
            _MEM[key] = (time.time(), h)
        return h
