from functools import lru_cache

import httpx
from supabase import Client, create_client

from app.config import get_settings


def _force_http1(client: Client) -> None:
    """Swap each sub-client's httpx session for an HTTP/1.1-only one.

    On some hosts (observed on Railway) the default HTTP/2 connection to
    Supabase is terminated mid-request — `RemoteProtocolError: Connection
    Terminated` — so every query silently returns empty. Forcing HTTP/1.1
    avoids it. Done defensively so a change in supabase-py internals can't
    break client creation.
    """
    for attr in ("postgrest", "auth", "storage"):
        try:
            sub = getattr(client, attr, None)
            sess = getattr(sub, "session", None) or getattr(sub, "_client", None)
            if sess is None:
                continue
            headers = dict(getattr(sess, "headers", {}) or {})
            base_url = str(getattr(sess, "base_url", "") or "")
            new = httpx.Client(base_url=base_url, headers=headers, http2=False,
                               timeout=getattr(sess, "timeout", None))
            if getattr(sub, "session", None) is not None:
                sub.session = new
            else:
                sub._client = new
        except Exception:
            # Leave this sub-client as-is; better a working default than a crash.
            pass


@lru_cache
def get_supabase() -> Client:
    """Return a cached Supabase client using the service-role key.

    Raises RuntimeError if Supabase is not configured; callers that want the
    optional fallback should catch it.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError("Supabase is not configured")
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    _force_http1(client)
    return client
