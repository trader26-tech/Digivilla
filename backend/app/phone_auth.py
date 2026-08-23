"""Phone-number (OTP) sign-in, backed by Firebase.

The frontend runs the OTP flow with the Firebase JS SDK (send code -> verify),
then posts the resulting Firebase **ID token** here. We verify that token with
the Firebase Admin SDK and, on success, find-or-create a local user keyed by the
phone number and hand back one of our own stateless session tokens — so the rest
of the app (goals, baskets) works unchanged via the existing `owner` id.

This reuses auth.py's storage + token helpers rather than duplicating them, and
only adds phone-specific logic here so it stays out of the way of the core
email/password auth.

Firebase Admin is OPTIONAL: if it isn't installed/configured, `verify_id_token`
returns None and — when `settings.allow_unverified_phone` is true (dev default)
— we trust the client-supplied phone so the flow works end to end without
credentials. In production, set that flag false and configure Admin so unverified
tokens are rejected.
"""

from __future__ import annotations

import re
import uuid

from app import auth as auth_svc
from app.config import get_settings

_PHONE_RE = re.compile(r"^\+?[1-9]\d{7,14}$")  # E.164-ish


class PhoneAuthError(Exception):
    """Raised when phone sign-in fails (bad token, bad number)."""


# ---------------- Firebase Admin (optional) ----------------

_admin_ready = False


def _ensure_admin() -> bool:
    """Initialise the Firebase Admin SDK once. Returns True if it's usable.

    Credentials are resolved in this order:
      1. FIREBASE_SERVICE_ACCOUNT — the service-account JSON *contents* pasted
         into one env var. This is the Railway-friendly way: no file to mount.
      2. GOOGLE_APPLICATION_CREDENTIALS — a filesystem path to the JSON, the
         Firebase/Google standard (handy for local dev).
    Any failure -> Admin is unavailable and we fall back to the unverified path
    (allowed only when settings.allow_unverified_phone is true)."""
    global _admin_ready
    if _admin_ready:
        return True
    try:
        import os
        import firebase_admin  # type: ignore
        from firebase_admin import credentials

        if not firebase_admin._apps:  # not yet initialised
            raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
            if raw:
                import json as _json

                cred = credentials.Certificate(_json.loads(raw))
                firebase_admin.initialize_app(cred)
            else:
                # Uses GOOGLE_APPLICATION_CREDENTIALS (a path) if set.
                firebase_admin.initialize_app()
        _admin_ready = True
        return True
    except Exception:
        return False


def verify_id_token(id_token: str) -> dict | None:
    """Verify a Firebase ID token -> its decoded claims (incl. phone_number),
    or None if Admin isn't available or the token is invalid."""
    if not id_token or not _ensure_admin():
        return None
    try:
        from firebase_admin import auth as fb_auth  # type: ignore

        return fb_auth.verify_id_token(id_token)
    except Exception:
        return None


# ---------------- storage helpers (reuse auth.py) ----------------

def _find_by_phone(phone: str) -> dict | None:
    if auth_svc._use_supabase():
        from app.supabase_client import get_supabase

        try:
            rows = get_supabase().table("users").select("*").eq("phone", phone).execute().data or []
            return rows[0] if rows else None
        except Exception as e:
            # The `users` table needs a nullable `phone` column for phone sign-in.
            # See the migration note at the bottom of this file.
            raise PhoneAuthError(
                "Phone sign-in isn't set up on the server yet (missing `phone` "
                "column on the users table)."
            ) from e
    for r in auth_svc._read_local():
        if r.get("phone") == phone:
            return r
    return None


def _normalise(phone: str) -> str:
    p = phone.strip().replace(" ", "")
    # bare 10-digit Indian number -> +91
    digits = re.sub(r"\D", "", p)
    if not p.startswith("+") and len(digits) == 10:
        return "+91" + digits
    return p if p.startswith("+") else "+" + digits


# ---------------- public API ----------------

def login_with_phone(name: str, phone: str, id_token: str = "") -> dict:
    """Verify the Firebase OTP result and find-or-create the user by phone.

    Returns {"token": <our session token>, "user": {...}} exactly like
    auth.login(), so the frontend + the rest of the app are unchanged."""
    e164 = _normalise(phone)
    if not _PHONE_RE.match(e164):
        raise PhoneAuthError("A valid phone number is required.")

    # Verify the Firebase token when Admin is configured; otherwise fall back to
    # trusting the client only if explicitly allowed (dev).
    claims = verify_id_token(id_token)
    if claims is None:
        settings = get_settings()
        if not getattr(settings, "allow_unverified_phone", True):
            raise PhoneAuthError("Could not verify your phone. Please try again.")
    else:
        # Prefer the phone Firebase actually verified.
        verified = claims.get("phone_number")
        if verified:
            e164 = verified

    user = _find_by_phone(e164)
    if user is None:
        row = {
            "id": uuid.uuid4().hex,
            "owner": "usr_" + uuid.uuid4().hex[:16],
            "email": "",           # phone users may have no email
            "phone": e164,
            "name": (name or "").strip(),
            "salt": "",            # no password for phone accounts
            "password_hash": "",
        }
        auth_svc._insert(row)
        user = row
    elif name and not user.get("name"):
        # backfill a name if we didn't have one — and persist it
        user["name"] = name.strip()
        _update_name(user["owner"], user["name"])

    return {"token": auth_svc._issue_token(user["owner"]), "user": auth_svc._public(user)}


def _update_name(owner: str, name: str) -> None:
    """Persist a backfilled name for an existing phone user."""
    if auth_svc._use_supabase():
        from app.supabase_client import get_supabase

        try:
            get_supabase().table("users").update({"name": name}).eq("owner", owner).execute()
        except Exception:
            pass  # non-fatal: the session still works
    else:
        rows = auth_svc._read_local()
        for r in rows:
            if r.get("owner") == owner:
                r["name"] = name
        auth_svc._write_local(rows)


# ─────────────────────────────────────────────────────────────────────────────
#  SUPABASE MIGRATION (run once if you use Supabase for users)
#  Phone accounts need a `phone` column and no password. In the Supabase SQL
#  editor:
#
#     ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text UNIQUE;
#     ALTER TABLE users ALTER COLUMN email DROP NOT NULL;          -- phone users have no email
#     ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;  -- and no password
#
#  Without Supabase, users are stored in app/data/users.json and this just works.
# ─────────────────────────────────────────────────────────────────────────────
