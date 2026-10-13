import threading

from supabase import Client, create_client

from app.config import get_settings

# One client PER THREAD. FastAPI runs sync endpoints on a thread pool; a single
# shared client's HTTP connection, used by several threads at once, fails with
# "[Errno 35] Resource temporarily unavailable" when the admin home fires its
# requests together. A client per worker thread keeps each connection private.
_local = threading.local()


def get_supabase() -> Client:
    """Return this thread's Supabase client (service-role key), creating it once.

    Raises RuntimeError if Supabase is not configured; callers that want the
    optional fallback should catch it.
    """
    c = getattr(_local, "client", None)
    if c is None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError("Supabase is not configured")
        c = _local.client = create_client(settings.supabase_url, settings.supabase_service_key)
    return c
