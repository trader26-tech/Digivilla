"""Admin login for the consultation dashboard.

A single admin identity, configured via ADMIN_USER / ADMIN_PASSWORD env vars.
Successful login returns a stateless HMAC-signed token (same structure as
app/auth.py) signed with ADMIN_TOKEN_SECRET, so admin tokens are distinct from
user tokens and can't be forged without the secret.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from app.config import get_settings

_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: str) -> str:
    secret = get_settings().admin_token_secret.encode("utf-8")
    return _b64u(hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).digest())


def issue_token() -> str:
    body = json.dumps({"admin": True, "exp": int(time.time()) + _TOKEN_TTL_SECONDS})
    payload = _b64u(body.encode("utf-8"))
    return f"{payload}.{_sign(payload)}"


def is_valid_token(token: str) -> bool:
    """True if the token is a well-formed, unexpired, correctly-signed admin token."""
    try:
        payload, sig = token.split(".", 1)
    except ValueError:
        return False
    if not hmac.compare_digest(sig, _sign(payload)):
        return False
    try:
        data = json.loads(_b64u_decode(payload))
    except Exception:
        return False
    if not data.get("admin"):
        return False
    return int(data.get("exp", 0)) >= int(time.time())


def check_credentials(username: str, password: str) -> bool:
    settings = get_settings()
    # Constant-time comparison to avoid leaking length/prefix timing.
    u_ok = hmac.compare_digest(username or "", settings.admin_user or "")
    p_ok = hmac.compare_digest(password or "", settings.admin_password or "")
    return u_ok and p_ok
