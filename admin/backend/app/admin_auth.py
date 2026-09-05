"""Admin sign-in: email OTP → trusted device (cookie) → PIN → access tokens.

This ports the Networth auth model to the consultation admin app so the single
admin signs in the same way:

  request-otp  → a 6-digit code is emailed to the allowlisted address
  verify-otp   → mints a trusted-device cookie (30 days) + a short access token
  set-pin      → the admin picks a 4–8 digit PIN
  unlock       → later visits use the device cookie + PIN, no email
  refresh      → slides the access token forward while active; idle → re-lock

Two token layers:
  • Device token  — long-lived (DEVICE_TTL_DAYS), stored hashed; the raw value
    lives only in the browser's httpOnly cookie. Proves "trusted device".
  • Access token  — short-lived, stateless HMAC bearer on every /admin call.

Storage mirrors bookings.py: Supabase when configured (tables `admin_otp`,
`admin_devices`), else local JSON under app/data/ so dev works with zero setup.
Codes and PINs are stored only as salted hashes; nothing sensitive in the clear.
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
from datetime import datetime, timezone
from typing import Any, Optional

from app.config import get_settings

# ── tunables ────────────────────────────────────────────────────────────────
OTP_TTL_SECONDS = 5 * 60          # code valid for 5 minutes
OTP_MAX_ATTEMPTS = 5              # wrong-code tries before the code is burned
OTP_RESEND_COOLDOWN = 30         # seconds between request-otp calls (per email)
OTP_MAX_PER_HOUR = 6             # request-otp calls per email per hour

PIN_MIN_LEN = 4
PIN_MAX_LEN = 4
PIN_MAX_ATTEMPTS = 5             # wrong-PIN tries before the device is revoked

LOCK_PRESETS = [10, 30, 60, 120]
MIN_LOCK_MINUTES = 5
MAX_LOCK_MINUTES = 240

DEVICE_COOKIE = "ml_admin_device"

_OTP_TABLE = "admin_otp"
_DEV_TABLE = "admin_devices"
_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_OTP_JSON = os.path.join(_DATA_DIR, "admin_otp.json")
_DEV_JSON = os.path.join(_DATA_DIR, "admin_devices.json")


# ── settings helpers ────────────────────────────────────────────────────────
def _allowlist_ordered() -> list[str]:
    raw = (get_settings().otp_allowlist or "").strip()
    return [e.strip().lower() for e in raw.split(",") if e.strip()]


def allowlist() -> set[str]:
    return set(_allowlist_ordered())


def primary_email() -> str:
    lst = _allowlist_ordered()
    return lst[0] if lst else ""


def is_allowed(email: str) -> bool:
    return (email or "").strip().lower() in allowlist()


def device_ttl_days() -> int:
    return int(get_settings().device_ttl_days or 30)


def default_lock_minutes() -> int:
    return int(get_settings().default_lock_minutes or 30)


def mask_email(email: str) -> str:
    try:
        name, dom = email.split("@", 1)
        shown = name[0] + "•••" + (name[-1] if len(name) > 1 else "")
        return f"{shown}@{dom}"
    except Exception:
        return "your email"


# ══════════════════════════════════════════════════════════════════════════════
# Storage: Supabase-or-local-JSON (same probe pattern as bookings.py)
# ══════════════════════════════════════════════════════════════════════════════
_TABLES_OK: Optional[bool] = None


def _client():
    """Return a Supabase client iff configured AND the admin tables exist,
    else None (→ local JSON fallback). Probed once, cached."""
    global _TABLES_OK
    try:
        from app.supabase_client import get_supabase

        cl = get_supabase()
    except Exception:
        return None
    if _TABLES_OK is None:
        try:
            cl.table(_DEV_TABLE).select("device_id").limit(1).execute()
            _TABLES_OK = True
        except Exception as e:
            msg = str(e).lower()
            if any(s in msg for s in ("admin_devices", "does not exist", "pgrst205",
                                      "schema cache", "could not find")):
                print("⚠ Supabase admin auth tables missing — using local JSON. "
                      "Run supabase_setup.sql to persist devices across redeploys.")
                _TABLES_OK = False
            else:
                _TABLES_OK = True  # transient error → let real calls surface it
    return cl if _TABLES_OK else None


def _load(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save(path: str, data: dict) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _now() -> int:
    return int(time.time())


def _iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _parse_iso(v: Any) -> int:
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except Exception:
        return 0


# ── hashing ─────────────────────────────────────────────────────────────────
def _sha(value: str, salt: str = "") -> str:
    return hashlib.sha256((salt + value).encode()).hexdigest()


def _pbkdf2(value: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", value.encode(), salt.encode(), 100_000).hex()


def _hash_token(raw: str) -> str:
    return _sha(raw)


# ══════════════════════════════════════════════════════════════════════════════
# OTP
# ══════════════════════════════════════════════════════════════════════════════
def otp_put(email: str, code: str) -> None:
    email = email.strip().lower()
    expires = _now() + OTP_TTL_SECONDS
    code_hash = _sha(code, salt=email)
    c = _client()
    if c:
        c.table(_OTP_TABLE).delete().eq("email", email).execute()
        c.table(_OTP_TABLE).insert({
            "email": email, "code_hash": code_hash,
            "expires_at": _iso(expires), "attempts": 0, "created_at": _iso(_now()),
        }).execute()
        return
    data = _load(_OTP_JSON)
    data[email] = {"code_hash": code_hash, "expires_at": expires, "attempts": 0,
                   "created_at": _now()}
    _save(_OTP_JSON, data)


def otp_check(email: str, code: str) -> tuple[bool, str]:
    email = email.strip().lower()
    code_hash = _sha(code, salt=email)
    c = _client()
    if c:
        rows = c.table(_OTP_TABLE).select("*").eq("email", email).limit(1).execute().data or []
        if not rows:
            return False, "Request a new code."
        row = rows[0]
        if _parse_iso(row.get("expires_at")) < _now():
            c.table(_OTP_TABLE).delete().eq("email", email).execute()
            return False, "Code expired — request a new one."
        if int(row.get("attempts") or 0) >= OTP_MAX_ATTEMPTS:
            c.table(_OTP_TABLE).delete().eq("email", email).execute()
            return False, "Too many attempts — request a new code."
        if hmac.compare_digest(row.get("code_hash") or "", code_hash):
            c.table(_OTP_TABLE).delete().eq("email", email).execute()
            return True, ""
        c.table(_OTP_TABLE).update({"attempts": int(row.get("attempts") or 0) + 1}).eq("email", email).execute()
        return False, "Incorrect code."

    data = _load(_OTP_JSON)
    row = data.get(email)
    if not row:
        return False, "Request a new code."
    if int(row.get("expires_at") or 0) < _now():
        data.pop(email, None); _save(_OTP_JSON, data)
        return False, "Code expired — request a new one."
    if int(row.get("attempts") or 0) >= OTP_MAX_ATTEMPTS:
        data.pop(email, None); _save(_OTP_JSON, data)
        return False, "Too many attempts — request a new code."
    if hmac.compare_digest(row.get("code_hash") or "", code_hash):
        data.pop(email, None); _save(_OTP_JSON, data)
        return True, ""
    row["attempts"] = int(row.get("attempts") or 0) + 1
    _save(_OTP_JSON, data)
    return False, "Incorrect code."


_otp_sends: dict[str, list[int]] = {}


def otp_rate_ok(email: str) -> tuple[bool, str]:
    email = email.strip().lower()
    now = _now()
    hits = [t for t in _otp_sends.get(email, []) if now - t < 3600]
    if hits and now - hits[-1] < OTP_RESEND_COOLDOWN:
        wait = OTP_RESEND_COOLDOWN - (now - hits[-1])
        return False, f"Please wait {wait}s before requesting another code."
    if len(hits) >= OTP_MAX_PER_HOUR:
        return False, "Too many codes requested. Try again later."
    hits.append(now)
    _otp_sends[email] = hits
    return True, ""


# ══════════════════════════════════════════════════════════════════════════════
# Devices (trusted device + PIN + per-device auto-lock)
# ══════════════════════════════════════════════════════════════════════════════
def device_create(email: str) -> tuple[str, str]:
    email = email.strip().lower()
    device_id = uuid.uuid4().hex
    raw = secrets.token_urlsafe(32)
    expires = _now() + device_ttl_days() * 86400
    row = {
        "device_id": device_id, "email": email,
        "token_hash": _hash_token(raw),
        "pin_hash": None, "pin_salt": None, "pin_attempts": 0,
        "lock_minutes": default_lock_minutes(),
        "expires_at": _iso(expires), "created_at": _iso(_now()),
        "last_used": _iso(_now()), "revoked": False,
    }
    c = _client()
    if c:
        c.table(_DEV_TABLE).insert(row).execute()
    else:
        row["expires_at"] = expires
        row["created_at"] = _now()
        row["last_used"] = _now()
        data = _load(_DEV_JSON)
        data[device_id] = row
        _save(_DEV_JSON, data)
    return device_id, raw


def device_get(device_id: str) -> Optional[dict]:
    if not device_id:
        return None
    c = _client()
    if c:
        rows = c.table(_DEV_TABLE).select("*").eq("device_id", device_id).limit(1).execute().data or []
        return rows[0] if rows else None
    return _load(_DEV_JSON).get(device_id)


def device_valid(device_id: str, raw_token: str) -> Optional[dict]:
    row = device_get(device_id)
    if not row or row.get("revoked"):
        return None
    if _parse_iso(row.get("expires_at")) < _now():
        return None
    if not hmac.compare_digest(row.get("token_hash") or "", _hash_token(raw_token or "")):
        return None
    return row


def device_update(device_id: str, **fields: Any) -> None:
    c = _client()
    if c:
        c.table(_DEV_TABLE).update(fields).eq("device_id", device_id).execute()
        return
    data = _load(_DEV_JSON)
    if device_id in data:
        data[device_id].update(fields)
        _save(_DEV_JSON, data)


def device_touch(device_id: str) -> None:
    device_update(device_id, last_used=_iso(_now()) if _client() else _now())


def device_delete(device_id: str) -> None:
    c = _client()
    if c:
        c.table(_DEV_TABLE).delete().eq("device_id", device_id).execute()
        return
    data = _load(_DEV_JSON)
    data.pop(device_id, None)
    _save(_DEV_JSON, data)


def device_set_pin(device_id: str, pin: str) -> None:
    salt = secrets.token_hex(16)
    device_update(device_id, pin_hash=_pbkdf2(pin, salt), pin_salt=salt, pin_attempts=0)


def device_check_pin(device_id: str, pin: str) -> tuple[bool, str]:
    row = device_get(device_id)
    if not row or row.get("revoked"):
        return False, "Device not recognised — sign in with email."
    if not row.get("pin_hash"):
        return False, "No PIN set on this device."
    if int(row.get("pin_attempts") or 0) >= PIN_MAX_ATTEMPTS:
        device_update(device_id, revoked=True)
        return False, "Too many wrong PINs — locked. Sign in with email."
    if hmac.compare_digest(row.get("pin_hash") or "", _pbkdf2(pin, row.get("pin_salt") or "")):
        device_update(device_id, pin_attempts=0)
        return True, ""
    attempts = int(row.get("pin_attempts") or 0) + 1
    if attempts >= PIN_MAX_ATTEMPTS:
        device_update(device_id, pin_attempts=attempts, revoked=True)
        return False, "Too many wrong PINs — locked. Sign in with email."
    device_update(device_id, pin_attempts=attempts)
    left = PIN_MAX_ATTEMPTS - attempts
    return False, f"Incorrect PIN — {left} attempt{'s' if left != 1 else ''} left."


# ══════════════════════════════════════════════════════════════════════════════
# Access tokens (stateless HMAC bearer — no DB round-trip per request)
# ══════════════════════════════════════════════════════════════════════════════
def _secret() -> bytes:
    return (get_settings().admin_token_secret or "dev-admin-insecure-change-me").encode()


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def mint_access(device_id: str, ttl_seconds: int) -> tuple[str, int]:
    exp = _now() + int(ttl_seconds)
    body = _b64e(json.dumps({"did": device_id, "exp": exp}, separators=(",", ":"),
                            sort_keys=True).encode())
    sig = _b64e(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", exp


def verify_access(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".", 1)
        expected = _b64e(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_b64d(body))
        if int(payload.get("exp", 0)) < _now():
            return None
        return payload
    except Exception:
        return None


def is_valid_token(token: str) -> bool:
    """True if a well-formed, unexpired access token for a live device."""
    payload = verify_access(token)
    if not payload:
        return False
    dev = device_get(payload.get("did", ""))
    return bool(dev) and not dev.get("revoked")


# ── email delivery (Resend; falls back to server log in dev) ─────────────────
def _otp_html(code: str) -> str:
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:440px;margin:0 auto;padding:32px 28px;background:#ffffff;border:1px solid #DDD6C7;border-radius:16px;color:#16302B">
  <div style="font-size:20px;font-weight:800;color:#16302B;margin-bottom:4px">◆ Digivilla <span style="color:#A67C2E">Admin</span></div>
  <div style="font-size:13px;color:#6b7c74;margin-bottom:24px">Secure sign-in code</div>
  <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#16302B;background:#F3EFE6;border-radius:12px;padding:18px 0;text-align:center">{code}</div>
  <div style="font-size:13px;color:#6b7c74;margin-top:22px;line-height:1.6">
    Enter this code to sign in. It expires in <b style="color:#16302B">5 minutes</b>.<br>
    If you didn't request this, ignore this email — no one can access the desk without it.
  </div>
</div>"""


def email_configured() -> bool:
    return bool((get_settings().resend_api_key or "").strip())


def send_otp(to_email: str, code: str) -> bool:
    """Email the code via Resend. Returns True if actually sent."""
    api_key = (get_settings().resend_api_key or "").strip()
    sender = (get_settings().otp_from or "onboarding@resend.dev").strip()
    if not api_key:
        print(f"\n{'='*52}\n  [Digivilla Admin OTP]  code for {to_email}: {code}\n"
              f"  (RESEND_API_KEY not set — printed to log for dev)\n{'='*52}\n", flush=True)
        return False
    try:
        import httpx

        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": f"Digivilla Admin <{sender}>",
                "to": [to_email],
                "subject": f"{code} is your Digivilla admin sign-in code",
                "html": _otp_html(code),
            },
            timeout=15,
        )
        if r.status_code >= 300:
            print(f"⚠ Resend error {r.status_code}: {r.text[:300]}", flush=True)
            return False
        return True
    except Exception as e:
        print(f"⚠ Resend send failed: {e}", flush=True)
        return False


def gen_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"
