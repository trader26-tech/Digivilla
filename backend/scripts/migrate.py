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
from pathlib import Path

# Ensure the backend root (which contains the `app` package) is importable,
# regardless of the current working directory or PYTHONPATH.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os  # noqa: E402
import re  # noqa: E402

from app.core.config import settings  # noqa: E402

_LOCALHOST_HOSTS = ("@localhost:", "@127.0.0.1:", "@localhost/", "@127.0.0.1/")
_MAX_ATTEMPTS = 6
_BACKOFF_SECONDS = 5


def _mask(url: str) -> str:
    """Hide the password when echoing the URL for diagnostics."""
    return re.sub(r"://([^:/@]+):[^@]*@", r"://\1:***@", url)


def _guard_database_url() -> None:
    url = settings.DATABASE_URL
    raw_env = os.environ.get("DATABASE_URL")

    # A localhost target is never valid on Railway — guard regardless of
    # ENVIRONMENT, so a missing/placeholder value fails clearly instead of
    # emitting a long SQLAlchemy connection-refused traceback.
    if any(host in url for host in _LOCALHOST_HOSTS):
        detail = (
            "the DATABASE_URL variable is UNSET (app fell back to the localhost "
            "default)"
            if raw_env is None
            else f"DATABASE_URL is set but points at localhost: {_mask(url)}"
        )
        sys.exit(
            "FATAL: cannot run migrations — " + detail + ".\n\n"
            "Set DATABASE_URL in the Railway service Variables to your Supabase\n"
            "connection string (Supabase > Settings > Database > Connection\n"
            "string > Transaction pooler, port 6543), and change the scheme to\n"
            "the async driver:\n"
            "  postgresql+asyncpg://postgres.<ref>:<password>"
            "@aws-0-<region>.pooler.supabase.com:6543/postgres\n"
        )

    # Guard against the common mistake of using a sync scheme with our async app.
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        sys.exit(
            "FATAL: DATABASE_URL must use the async driver scheme "
            "'postgresql+asyncpg://', got: " + _mask(url) + "\n"
            "Change the 'postgresql://' prefix to 'postgresql+asyncpg://'."
        )

    print(f"DATABASE_URL OK -> {_mask(url)}", flush=True)


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
