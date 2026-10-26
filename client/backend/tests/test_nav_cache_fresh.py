"""A cache row with a non-ISO date is never 'fresh' — the refresher replaces it, whoever wrote it."""
from datetime import datetime, timezone

from app import nav_cache as NC


def test_non_iso_date_is_stale():
    now = datetime.now(timezone.utc).isoformat()
    assert not NC._is_fresh({"nav": 97.961, "nav_date": "23-10-2026", "fetched_at": now})
    assert NC._is_fresh({"nav": 98.864, "nav_date": NC._today_iso(), "fetched_at": now})
    assert NC._is_fresh({"nav": 98.864, "nav_date": "2026-10-23", "fetched_at": now})      # pulled just now = latest
    assert not NC._is_fresh({"nav": None, "nav_date": NC._today_iso(), "fetched_at": now})
