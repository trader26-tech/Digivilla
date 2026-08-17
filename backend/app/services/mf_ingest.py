"""Ingest Indian mutual fund data from free, official sources.

Sources
-------
* AMFI NAVAll feed (https://www.amfiindia.com/spages/NAVAll.txt): the canonical
  daily NAV for every scheme in India. Free, no auth. Used to populate the
  scheme catalog + latest NAV.
* mfapi.in (https://api.mfapi.in/mf/<code>): free wrapper over AMFI history,
  used to backfill per-scheme NAV history for charts and analytics.

We cache everything in Postgres and serve from there, so the UI stays fast and
resilient to source downtime.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mutual_fund import NavHistory, Scheme

logger = logging.getLogger(__name__)

AMFI_NAV_ALL_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
MFAPI_SCHEME_URL = "https://api.mfapi.in/mf/{code}"

# A line is a scheme row when it has 6 semicolon fields and starts with a code.
_SCHEME_ROW = re.compile(r"^\d+;")


@dataclass
class ParsedScheme:
    scheme_code: int
    isin_growth: str | None
    isin_div_reinvestment: str | None
    scheme_name: str
    nav: float | None
    nav_date: date | None
    fund_house: str | None
    scheme_type: str | None
    scheme_category: str | None
    plan: str | None
    option: str | None


def _clean(value: str) -> str | None:
    value = value.strip()
    return None if value in {"", "-", "N.A.", "N/A"} else value


def _parse_float(value: str) -> float | None:
    value = _clean(value) or ""
    try:
        return float(value)
    except ValueError:
        return None


def _parse_date(value: str) -> date | None:
    value = _clean(value) or ""
    for fmt in ("%d-%b-%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _derive_plan_option(name: str) -> tuple[str | None, str | None]:
    upper = name.upper()
    plan = "DIRECT" if "DIRECT" in upper else ("REGULAR" if "REGULAR" in upper else None)
    if "GROWTH" in upper:
        option = "GROWTH"
    elif "IDCW" in upper or "DIVIDEND" in upper:
        option = "IDCW"
    else:
        option = None
    return plan, option


def parse_navall(text: str) -> list[ParsedScheme]:
    """Parse AMFI's NAVAll.txt.

    The file interleaves data rows with section headers: a line in parentheses
    is a scheme *type/category*, and a non-empty line that is neither a header
    nor a data row is a *fund house* name.
    """
    schemes: list[ParsedScheme] = []
    current_type: str | None = None
    current_category: str | None = None
    current_house: str | None = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        if _SCHEME_ROW.match(line):
            parts = line.split(";")
            if len(parts) < 6:
                continue
            code_str, isin1, isin2, name, nav_str, date_str = parts[:6]
            name = name.strip()
            plan, option = _derive_plan_option(name)
            schemes.append(
                ParsedScheme(
                    scheme_code=int(code_str),
                    isin_growth=_clean(isin1),
                    isin_div_reinvestment=_clean(isin2),
                    scheme_name=name,
                    nav=_parse_float(nav_str),
                    nav_date=_parse_date(date_str),
                    fund_house=current_house,
                    scheme_type=current_type,
                    scheme_category=current_category,
                    plan=plan,
                    option=option,
                )
            )
            continue

        # Header lines. The catalog uses "Open Ended Schemes(Category Name)".
        m = re.match(r"^(.*?)\((.*)\)\s*$", line)
        if m and ("Scheme" in m.group(1) or "Schemes" in m.group(1)):
            current_type = m.group(1).strip()
            current_category = m.group(2).strip()
            continue

        # Otherwise it's a fund-house name (skip the column header line).
        if not line.lower().startswith("scheme code"):
            current_house = line

    return schemes


async def fetch_navall(client: httpx.AsyncClient) -> list[ParsedScheme]:
    resp = await client.get(AMFI_NAV_ALL_URL, follow_redirects=True, timeout=60)
    resp.raise_for_status()
    return parse_navall(resp.text)


async def sync_catalog(db: AsyncSession) -> int:
    """Refresh the scheme catalog + latest NAV from AMFI. Returns scheme count."""
    async with httpx.AsyncClient() as client:
        parsed = await fetch_navall(client)

    if not parsed:
        logger.warning("AMFI returned no schemes; skipping catalog sync")
        return 0

    rows = [
        {
            "scheme_code": p.scheme_code,
            "scheme_name": p.scheme_name,
            "fund_house": p.fund_house,
            "scheme_type": p.scheme_type,
            "scheme_category": p.scheme_category,
            "isin_growth": p.isin_growth,
            "isin_div_reinvestment": p.isin_div_reinvestment,
            "plan": p.plan,
            "option": p.option,
            "latest_nav": p.nav,
            "latest_nav_date": p.nav_date,
        }
        for p in parsed
    ]

    # Upsert in batches to keep statements a sane size.
    updatable = {
        c: getattr(pg_insert(Scheme).excluded, c)
        for c in (
            "scheme_name",
            "fund_house",
            "scheme_type",
            "scheme_category",
            "isin_growth",
            "isin_div_reinvestment",
            "plan",
            "option",
            "latest_nav",
            "latest_nav_date",
        )
    }
    batch = 1000
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        stmt = pg_insert(Scheme).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=["scheme_code"], set_=updatable
        )
        await db.execute(stmt)
    await db.commit()
    logger.info("Synced %d schemes from AMFI", len(rows))
    return len(rows)


async def sync_scheme_history(db: AsyncSession, scheme_code: int) -> int:
    """Backfill full NAV history for one scheme from mfapi. Returns points added."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            MFAPI_SCHEME_URL.format(code=scheme_code), timeout=60
        )
        resp.raise_for_status()
        payload = resp.json()

    data = payload.get("data") or []
    if not data:
        return 0

    rows = []
    for point in data:
        d = _parse_date(point.get("date", ""))
        nav = _parse_float(point.get("nav", ""))
        if d is None or nav is None:
            continue
        rows.append({"scheme_code": scheme_code, "date": d, "nav": nav})

    if rows:
        for i in range(0, len(rows), 1000):
            chunk = rows[i : i + 1000]
            stmt = pg_insert(NavHistory).values(chunk)
            stmt = stmt.on_conflict_do_nothing(
                index_elements=["scheme_code", "date"]
            )
            await db.execute(stmt)

    scheme = await db.get(Scheme, scheme_code)
    if scheme is not None:
        scheme.history_synced_at = datetime.utcnow()
    await db.commit()
    return len(rows)


async def catalog_is_empty(db: AsyncSession) -> bool:
    count = await db.scalar(select(func.count()).select_from(Scheme))
    return (count or 0) == 0
