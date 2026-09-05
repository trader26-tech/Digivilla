"""Admin API — the consultation desk backend.

Serves the admin dashboard (bookings, availability, per-client documents) and
the public booking endpoints the client app uses to submit a request and grey
out taken slots. It shares the SAME Supabase database as the client backend, so
a booking confirmed here is immediately visible in the client app.

Routes:
  /health                         — health check
  /bookings, /bookings/taken      — public (called by the client SPA)
  /admin/auth/*                   — email-OTP → PIN → trusted-device sign-in
  /admin/bookings*                — list / update status / delete
  /admin/availability*            — working-hours config + block/free slots
  /admin/clients, /admin/documents* — per-client document vault
"""

from __future__ import annotations

from typing import Optional

from fastapi import (
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as RawResponse

from app import admin_auth
from app import availability as availability_svc
from app import bookings as bookings_svc
from app import documents as documents_svc
from app.config import get_settings
from app.schemas import (
    AdminLockBody,
    AdminOtpRequest,
    AdminOtpVerify,
    AdminPinBody,
    AvailabilityConfig,
    BlockSlotBody,
    Booking,
    BookingCreate,
    BookingStatusUpdate,
    ClientCreate,
)

settings = get_settings()

app = FastAPI(title="Digivilla Admin API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Auth guards ----------------------------------------------------------
def _require_admin(authorization: Optional[str]) -> None:
    token = authorization.replace("Bearer ", "", 1) if authorization else ""
    if not admin_auth.is_valid_token(token):
        raise HTTPException(status_code=401, detail="Admin login required")


def _admin_device(request: Request) -> str:
    """device_id from a valid Bearer access token, or 401."""
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    payload = admin_auth.verify_access(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Session expired")
    return payload["did"]


# Same-origin combined deploy → SameSite=Lax persists reliably (incl. iOS PWA).
# Set COOKIE_SAMESITE=none (with Secure) only if the admin SPA is ever hosted on
# a different origin than this API again.
_COOKIE_SAMESITE = (settings.cookie_samesite or "lax").lower()
_COOKIE_SECURE = _COOKIE_SAMESITE == "none" or settings.cookie_secure


def _set_admin_cookie(resp: Response, raw: str) -> None:
    resp.set_cookie(
        admin_auth.DEVICE_COOKIE, raw,
        max_age=admin_auth.device_ttl_days() * 86400,
        httponly=True, secure=_COOKIE_SECURE, samesite=_COOKIE_SAMESITE, path="/",
    )


# --- Public bookings (called by the client SPA) ---------------------------
@app.post("/bookings", response_model=Booking)
def create_booking(payload: BookingCreate) -> Booking:
    """A user requests a consultation slot when reserving a plot."""
    return bookings_svc.create_booking(payload)


@app.get("/bookings/taken")
def taken_slots() -> dict:
    """Public: ISO slots unavailable to clients — confirmed bookings PLUS the
    slots the admin has blocked — so the picker greys them out."""
    slots = set(bookings_svc.confirmed_slots()) | set(availability_svc.blocked_slots())
    return {"slots": sorted(slots)}


# --- Admin sign-in: email OTP → trusted device → PIN → access tokens ------
@app.get("/admin/auth/session")
def admin_session(request: Request) -> dict:
    """Bootstrap the lock screen — reads the device cookie only, returns no data."""
    raw = request.cookies.get(admin_auth.DEVICE_COOKIE, "")
    dev = None
    if "." in raw:
        did, tok = raw.split(".", 1)
        dev = admin_auth.device_valid(did, tok)
    signin_email = admin_auth.mask_email(admin_auth.primary_email())
    if not dev:
        return {"device_known": False, "has_pin": False, "email": None,
                "signin_email": signin_email,
                "lock_minutes": admin_auth.default_lock_minutes(),
                "lock_presets": admin_auth.LOCK_PRESETS}
    return {
        "device_known": True,
        "has_pin": bool(dev.get("pin_hash")),
        "email": admin_auth.mask_email(dev.get("email") or ""),
        "signin_email": signin_email,
        "lock_minutes": int(dev.get("lock_minutes") or admin_auth.default_lock_minutes()),
        "lock_presets": admin_auth.LOCK_PRESETS,
    }


@app.post("/admin/auth/request-otp")
def admin_request_otp(body: AdminOtpRequest) -> dict:
    email = (body.email or "").strip().lower() or admin_auth.primary_email()
    # Same response whether or not the address is allowed (don't leak allowlist).
    if admin_auth.is_allowed(email):
        ok, msg = admin_auth.otp_rate_ok(email)
        if not ok:
            raise HTTPException(status_code=429, detail=msg)
        code = admin_auth.gen_code()
        admin_auth.otp_put(email, code)
        emailed = admin_auth.send_otp(email, code)
    else:
        emailed = True
    return {"ok": True, "emailed": bool(emailed), "masked": admin_auth.mask_email(email)}


@app.post("/admin/auth/verify-otp")
def admin_verify_otp(body: AdminOtpVerify, response: Response) -> dict:
    email = (body.email or "").strip().lower() or admin_auth.primary_email()
    if not admin_auth.is_allowed(email):
        raise HTTPException(status_code=401, detail="Incorrect code.")
    ok, msg = admin_auth.otp_check(email, (body.code or "").strip())
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    device_id, raw = admin_auth.device_create(email)
    _set_admin_cookie(response, f"{device_id}.{raw}")
    token, exp = admin_auth.mint_access(device_id, admin_auth.default_lock_minutes() * 60)
    return {"access_token": token, "expires_at": exp,
            "lock_minutes": admin_auth.default_lock_minutes(), "has_pin": False,
            "email": admin_auth.mask_email(email), "lock_presets": admin_auth.LOCK_PRESETS}


@app.post("/admin/auth/set-pin")
def admin_set_pin(body: AdminPinBody, request: Request) -> dict:
    device_id = _admin_device(request)
    pin = (body.pin or "").strip()
    if not pin.isdigit() or not (admin_auth.PIN_MIN_LEN <= len(pin) <= admin_auth.PIN_MAX_LEN):
        raise HTTPException(status_code=400,
                            detail=f"PIN must be {admin_auth.PIN_MIN_LEN}–{admin_auth.PIN_MAX_LEN} digits.")
    if not admin_auth.device_get(device_id):
        raise HTTPException(status_code=401, detail="Device not recognised.")
    admin_auth.device_set_pin(device_id, pin)
    return {"ok": True}


@app.post("/admin/auth/unlock")
def admin_unlock(body: AdminPinBody, request: Request) -> dict:
    raw = request.cookies.get(admin_auth.DEVICE_COOKIE, "")
    if "." not in raw:
        raise HTTPException(status_code=401, detail="Device not recognised — sign in with email.")
    did, tok = raw.split(".", 1)
    dev = admin_auth.device_valid(did, tok)
    if not dev:
        raise HTTPException(status_code=401, detail="Device not recognised — sign in with email.")
    ok, msg = admin_auth.device_check_pin(did, (body.pin or "").strip())
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    admin_auth.device_touch(did)
    lock_minutes = int(dev.get("lock_minutes") or admin_auth.default_lock_minutes())
    token, exp = admin_auth.mint_access(did, lock_minutes * 60)
    return {"access_token": token, "expires_at": exp, "lock_minutes": lock_minutes}


@app.post("/admin/auth/refresh")
def admin_refresh(request: Request) -> dict:
    device_id = _admin_device(request)
    dev = admin_auth.device_get(device_id)
    if not dev or dev.get("revoked"):
        raise HTTPException(status_code=401, detail="Device revoked.")
    lock_minutes = int(dev.get("lock_minutes") or admin_auth.default_lock_minutes())
    token, exp = admin_auth.mint_access(device_id, lock_minutes * 60)
    return {"access_token": token, "expires_at": exp, "lock_minutes": lock_minutes}


@app.post("/admin/auth/logout")
def admin_logout(request: Request, response: Response) -> dict:
    raw = request.cookies.get(admin_auth.DEVICE_COOKIE, "")
    if "." in raw:
        admin_auth.device_delete(raw.split(".", 1)[0])
    response.delete_cookie(admin_auth.DEVICE_COOKIE, path="/", samesite=_COOKIE_SAMESITE, secure=_COOKIE_SECURE)
    return {"ok": True}


@app.post("/admin/auth/settings")
def admin_set_settings(body: AdminLockBody, request: Request) -> dict:
    device_id = _admin_device(request)
    mins = int(body.lock_minutes)
    if not (admin_auth.MIN_LOCK_MINUTES <= mins <= admin_auth.MAX_LOCK_MINUTES):
        raise HTTPException(status_code=400,
                            detail=f"Auto-lock must be {admin_auth.MIN_LOCK_MINUTES}–{admin_auth.MAX_LOCK_MINUTES} minutes.")
    if not admin_auth.device_get(device_id):
        raise HTTPException(status_code=401, detail="Device not recognised.")
    admin_auth.device_update(device_id, lock_minutes=mins)
    return {"ok": True, "lock_minutes": mins}


# --- Admin availability ---------------------------------------------------
@app.get("/admin/availability")
def admin_availability(
    days: int = 14, authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    return {"config": availability_svc.get_config(),
            "days": availability_svc.day_grid(days)}


@app.post("/admin/availability/config")
def admin_availability_config(
    body: AvailabilityConfig, authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    cfg = availability_svc.set_config(body.model_dump(exclude_none=True))
    return {"config": cfg}


@app.post("/admin/availability/block")
def admin_availability_block(
    body: BlockSlotBody, authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    availability_svc.set_blocked(body.slot, body.blocked)
    return {"ok": True, "blocked": availability_svc.blocked_slots()}


# --- Admin client documents ----------------------------------------------
@app.get("/admin/clients")
def admin_clients(authorization: Optional[str] = Header(default=None)) -> list[dict]:
    _require_admin(authorization)
    return documents_svc.list_clients()


@app.post("/admin/clients")
def admin_create_client(
    body: ClientCreate, authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    try:
        return documents_svc.create_client(body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/admin/documents")
def admin_documents(
    client: str, authorization: Optional[str] = Header(default=None),
) -> list[dict]:
    _require_admin(authorization)
    return documents_svc.list_documents(client)


@app.post("/admin/documents")
async def admin_upload_document(
    client: str = Form(...),
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    content = await file.read()
    try:
        return documents_svc.add_document(
            client, file.filename or "file", content,
            file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/admin/documents/{doc_id}/download")
def admin_download_document(
    doc_id: str, authorization: Optional[str] = Header(default=None),
):
    _require_admin(authorization)
    got = documents_svc.get_document(doc_id)
    if not got:
        raise HTTPException(status_code=404, detail="Document not found")
    row, data = got
    return RawResponse(
        content=data,
        media_type=row.get("content_type") or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{row.get("filename", "file")}"'},
    )


@app.delete("/admin/documents/{doc_id}")
def admin_delete_document(
    doc_id: str, authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    if not documents_svc.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "deleted"}


# --- Admin bookings -------------------------------------------------------
@app.get("/admin/bookings", response_model=list[Booking])
def admin_list_bookings(
    authorization: Optional[str] = Header(default=None),
) -> list[Booking]:
    _require_admin(authorization)
    return bookings_svc.list_bookings()


@app.post("/admin/bookings/{booking_id}/status", response_model=Booking)
def admin_set_status(
    booking_id: str,
    payload: BookingStatusUpdate,
    authorization: Optional[str] = Header(default=None),
) -> Booking:
    _require_admin(authorization)
    updated = bookings_svc.set_status(booking_id, payload.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Booking not found")
    return updated


@app.delete("/admin/bookings/{booking_id}")
def admin_delete_booking(
    booking_id: str,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(authorization)
    ok = bookings_svc.delete_booking(booking_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"status": "deleted"}


# Serve the built admin Angular SPA (combined single-service deploy). Must be
# last so the catch-all route does not shadow the API endpoints above.
from app.static_spa import mount_spa  # noqa: E402

mount_spa(app)
