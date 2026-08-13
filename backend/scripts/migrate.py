"""Run Alembic migrations at container start, with a clear error and retries.

Replaces a bare `alembic upgrade head` in the container CMD so that:
  * a missing/placeholder DATABASE_URL fails with an actionable message rather
    than a wall of SQLAlchemy traceback, and
  * a transient DB unavailability (cold Supabase, brief network blip) is retried
    instead of crashing the deploy.
"""

import subprocess
import sys
import time

from app.core.config import settings

_LOCALHOST_DEFAULT = "@localhost:"
_MAX_ATTEMPTS = 6
_BACKOFF_SECONDS = 5


def _guard_database_url() -> None:
    url = settings.DATABASE_URL
    if settings.is_production and _LOCALHOST_DEFAULT in url:
        sys.exit(
            "FATAL: DATABASE_URL is not set (still pointing at localhost).\n"
            "Set DATABASE_URL in the Railway service Variables to your Supabase\n"
            "connection string, e.g.\n"
            "  postgresql+asyncpg://postgres.<ref>:<password>"
            "@aws-0-<region>.pooler.supabase.com:6543/postgres"
        )


def _run_migrations() -> None:
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        result = subprocess.run(["alembic", "upgrade", "head"])
        if result.returncode == 0:
            return
        if attempt == _MAX_ATTEMPTS:
            sys.exit(
                f"FATAL: migrations failed after {_MAX_ATTEMPTS} attempts. "
                "Check DATABASE_URL and that the database is reachable."
            )
        wait = _BACKOFF_SECONDS * attempt
        print(
            f"Migration attempt {attempt}/{_MAX_ATTEMPTS} failed; "
            f"retrying in {wait}s...",
            flush=True,
        )
        time.sleep(wait)


def main() -> None:
    _guard_database_url()
    _run_migrations()


if __name__ == "__main__":
    main()
