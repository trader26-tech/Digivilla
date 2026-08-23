"""Minimal, real authentication for MyLakshyas.

This is intentionally lightweight — the app is primarily a goal planner, not an
auth product — but it works under the hood: passwords are salted + hashed with
PBKDF2 (stdlib, no extra deps), and sessions are stateless HMAC-signed tokens.

Users are stored in Supabase (`users` table) when configured, otherwise in a
local JSON file so signup/login work out of the box in development — mirroring
the storage pattern in goals.py / baskets.py.

Each user gets a stable `owner` id (`usr_<hex>`) that keys their goals and
baskets, so the rest of the app is unchanged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid

from app.config import get_settings

_LOCAL_PATH = os.path.join(os.path.dirname(__file__), "data", "users.json")
_PBKDF2_ROUNDS = 200_000
_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days


class AuthError(Exception):
    """Raised for any auth failure (bad credentials, duplicate email, ...)."""


# ---------------- storage ----------------

def _use_supabase() -> bool:
    try:
        from app.supabase_client import get_supabase

        get_supabase()  # raises if not configured
        return True
    except Exception:
        return False


def _read_local() -> list[dict]:
    if os.path.exists(_LOCAL_PATH):
        with open(_LOCAL_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    return []


def _write_local(rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(_LOCAL_PATH), exist_ok=True)
    with open(_LOCAL_PATH, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)


def _find_by_email(email: str) -> dict | None:
    email = email.strip().lower()
    if _use_supabase():
        from app.supabase_client import get_supabase

        rows = get_supabase().table("users").select("*").eq("email", email).execute().data or []
        return rows[0] if rows else None
    for r in _read_local():
        if r.get("email") == email:
            return r
    return None


def _find_by_owner(owner: str) -> dict | None:
    if _use_supabase():
        from app.supabase_client import get_supabase

        rows = get_supabase().table("users").select("*").eq("owner", owner).execute().data or []
        return rows[0] if rows else None
    for r in _read_local():
        if r.get("owner") == owner:
            return r
    return None


def _insert(row: dict) -> None:
    if _use_supabase():
        from app.supabase_client import get_supabase

        get_supabase().table("users").insert(row).execute()
    else:
        rows = _read_local()
        rows.append(row)
        _write_local(rows)


# ---------------- password hashing ----------------

def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), _PBKDF2_ROUNDS
    )
    return dk.hex()


def _verify_password(password: str, salt: str, expected: str) -> bool:
    return hmac.compare_digest(_hash_password(password, salt), expected)


# ---------------- stateless tokens ----------------

def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(payload: str) -> str:
    secret = get_settings().auth_secret.encode("utf-8")
    return _b64u(hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).digest())


def _issue_token(owner: str) -> str:
    body = json.dumps({"owner": owner, "exp": int(time.time()) + _TOKEN_TTL_SECONDS})
    payload = _b64u(body.encode("utf-8"))
    return f"{payload}.{_sign(payload)}"


def owner_from_token(token: str) -> str | None:
    """Return the owner id if the token is valid and unexpired, else None."""
    try:
        payload, sig = token.split(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        data = json.loads(_b64u_decode(payload))
    except Exception:
        return None
    if int(data.get("exp", 0)) < int(time.time()):
        return None
    return data.get("owner")


# ---------------- public API ----------------

def _public(user: dict) -> dict:
    return {"owner": user["owner"], "email": user["email"], "name": user.get("name", "")}


def signup(email: str, password: str, name: str = "") -> dict:
    email = email.strip().lower()
    if not email or "@" not in email:
        raise AuthError("A valid email is required.")
    if len(password) < 6:
        raise AuthError("Password must be at least 6 characters.")
    if _find_by_email(email):
        raise AuthError("An account with that email already exists.")

    salt = secrets.token_hex(16)
    row = {
        "id": uuid.uuid4().hex,
        "owner": "usr_" + uuid.uuid4().hex[:16],
        "email": email,
        "name": name.strip(),
        "salt": salt,
        "password_hash": _hash_password(password, salt),
    }
    _insert(row)
    user = _public(row)
    return {"token": _issue_token(row["owner"]), "user": user}


def login(email: str, password: str) -> dict:
    user = _find_by_email(email)
    if not user or not _verify_password(password, user.get("salt", ""), user.get("password_hash", "")):
        raise AuthError("Incorrect email or password.")
    return {"token": _issue_token(user["owner"]), "user": _public(user)}


def me(token: str) -> dict | None:
    owner = owner_from_token(token)
    if not owner:
        return None
    user = _find_by_owner(owner)
    return _public(user) if user else None
