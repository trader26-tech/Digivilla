"""Background scheduling for mutual fund data refresh.

On startup we seed the catalog if empty; then AMFI is refreshed daily (NAVs
publish once per day). All work runs against its own DB session so it is
independent of request lifecycles.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.session import AsyncSessionLocal
from app.services import mf_ingest

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def refresh_catalog_job() -> None:
    async with AsyncSessionLocal() as db:
        try:
            count = await mf_ingest.sync_catalog(db)
            logger.info("Scheduled AMFI catalog refresh: %d schemes", count)
        except Exception:  # noqa: BLE001
            logger.exception("Scheduled AMFI catalog refresh failed")


async def seed_if_empty() -> None:
    async with AsyncSessionLocal() as db:
        try:
            if await mf_ingest.catalog_is_empty(db):
                logger.info("Scheme catalog empty; seeding from AMFI...")
                await mf_ingest.sync_catalog(db)
        except Exception:  # noqa: BLE001
            logger.exception("Initial catalog seed failed")


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")
    # AMFI publishes NAVs by ~11pm IST; refresh at 11:30pm and again mid-morning.
    _scheduler.add_job(refresh_catalog_job, "cron", hour=23, minute=30, id="amfi_night")
    _scheduler.add_job(refresh_catalog_job, "cron", hour=9, minute=0, id="amfi_morning")
    _scheduler.start()
    logger.info("MF scheduler started")


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
