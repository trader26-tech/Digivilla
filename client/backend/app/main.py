from __future__ import annotations

from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import engine
from app.config import get_settings
from app.funds import FUND_UNIVERSE, Fund
from app.presets import GOAL_PRESETS, PRESET_BY_KEY
from app.schemas import (
    FundRecommendation,
    PlanRequest,
    PlanResponse,
    SimulationBands,
)

settings = get_settings()

app = FastAPI(title="Goal Planner API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_fund_universe() -> list[Fund]:
    """Load funds from Supabase if the table exists, else use the code universe."""
    try:
        from app.supabase_client import get_supabase

        resp = get_supabase().table("funds").select("*").execute()
        rows = resp.data or []
        if rows:
            return [
                Fund(
                    code=r["code"],
                    name=r["name"],
                    category=r["category"],
                    asset_class=r["asset_class"],
                    risk=r["risk"],
                    expected_return=float(r["expected_return"]),
                    volatility=float(r["volatility"]),
                    expense_ratio=float(r["expense_ratio"]),
                    description=r.get("description", ""),
                )
                for r in rows
            ]
    except Exception:
        # No Supabase configured / table missing — fall back silently.
        pass
    return FUND_UNIVERSE


def _currency(v: float) -> str:
    """Format an amount in Indian ₹ with lakh/crore words."""
    if v >= 1e7:
        return f"₹{v / 1e7:.2f} Cr"
    if v >= 1e5:
        return f"₹{v / 1e5:.2f} L"
    return f"₹{v:,.0f}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/presets", response_model=list)
def presets() -> list:
    return [p.model_dump() for p in GOAL_PRESETS]


@app.post("/plan", response_model=PlanResponse)
def create_plan(req: PlanRequest) -> PlanResponse:
    universe = load_fund_universe()

    stated_risk = req.risk
    if stated_risk is None:
        preset = PRESET_BY_KEY.get(req.goal)
        stated_risk = preset.default_risk if preset else "balanced"

    resolved = engine.resolve_risk(req.horizon_years, stated_risk)
    recs = engine.select_funds(resolved, universe)
    exp_return, vol = engine.portfolio_stats(recs)

    # Size the SIP against the *median* compound growth rate (accounts for
    # volatility drag) so the typical outcome meets the target, not just the
    # lucky mean. This lands the p50 simulation on/above the goal.
    planning_return = engine.median_growth_rate(exp_return, vol)
    monthly = engine.required_monthly_sip(req.target_amount, planning_return, req.horizon_years)
    sim = engine.monte_carlo(
        monthly=monthly,
        annual_return=exp_return,
        annual_vol=vol,
        years=req.horizon_years,
        target=req.target_amount,
    )

    fund_recs = [
        FundRecommendation(
            code=r.fund.code,
            name=r.fund.name,
            category=r.fund.category,
            asset_class=r.fund.asset_class,
            risk=r.fund.risk,
            expected_return=r.fund.expected_return,
            volatility=r.fund.volatility,
            expense_ratio=r.fund.expense_ratio,
            weight=r.weight,
            monthly_amount=round(monthly * r.weight),
            rationale=r.rationale,
        )
        for r in recs
    ]

    article = "an" if resolved[0] in "aeiou" else "a"
    summary = (
        f"To reach {_currency(req.target_amount)} in {req.horizon_years:g} years, "
        f"invest about {_currency(monthly)} per month via SIP into {article} {resolved} portfolio "
        f"(expected ~{exp_return * 100:.1f}% p.a.). Across 5,000 simulations the median "
        f"outcome is {_currency(sim.p50)} with a {sim.success_rate * 100:.0f}% chance of "
        f"meeting or beating your target."
    )

    return PlanResponse(
        goal=req.goal,
        target_amount=req.target_amount,
        horizon_years=req.horizon_years,
        resolved_risk=resolved,
        monthly_investment=round(monthly),
        total_invested=round(sim.invested),
        expected_return=exp_return,
        portfolio_volatility=vol,
        projected_p10=round(sim.p10),
        projected_p50=round(sim.p50),
        projected_p90=round(sim.p90),
        projected_mean=round(sim.mean),
        success_rate=sim.success_rate,
        recommendations=fund_recs,
        bands=SimulationBands(**sim.percentile_paths),
        summary=summary,
    )


# --- Dashboard (fund research) endpoints ----------------------------------
from fastapi import HTTPException, Query  # noqa: E402

from app import dashboard  # noqa: E402
from app.schemas import DashboardOverview, FundDetail  # noqa: E402


@app.get("/dashboard/overview", response_model=DashboardOverview)
def dashboard_overview() -> DashboardOverview:
    return dashboard.get_overview()


@app.get("/dashboard/funds", response_model=dict)
def dashboard_funds(
    bucket: Optional[str] = None,
    q: Optional[str] = None,
    asset_class: Optional[str] = None,
    sort: str = Query("score", pattern="^(score|return_1y|return_3y|return_5y|volatility|rating)$"),
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> dict:
    total, funds = dashboard.list_funds(
        bucket=bucket, q=q, asset_class=asset_class, sort=sort, limit=limit, offset=offset
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [f.model_dump() for f in funds],
    }


@app.get("/dashboard/funds/{scheme_code}", response_model=FundDetail)
def dashboard_fund_detail(scheme_code: int) -> FundDetail:
    detail = dashboard.get_fund_detail(scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Fund not found")
    return detail


@app.get("/dashboard/funds/{scheme_code}/nav")
def dashboard_fund_nav(scheme_code: int):
    """NAV history split into 1Y / 3Y / 5Y / max windows for the detail chart."""
    result = dashboard.get_nav_windows(scheme_code)
    if result is None:
        raise HTTPException(status_code=404, detail="NAV history unavailable")
    return result


# --- Goals (home monitoring) endpoints ------------------------------------
from app import goals as goals_svc  # noqa: E402
from app.schemas import Goal, GoalCreate, GoalProgress  # noqa: E402


@app.get("/goals", response_model=list)
def list_goals(owner: Optional[str] = None) -> list:
    result = []
    for g in goals_svc.list_goals(owner=owner):
        result.append(
            {**g.model_dump(), "progress": goals_svc.compute_progress(g).model_dump()}
        )
    return result


@app.post("/goals", response_model=Goal)
def create_goal(payload: GoalCreate) -> Goal:
    return goals_svc.create_goal(payload)


@app.delete("/goals/{goal_id}")
def delete_goal(goal_id: str, owner: Optional[str] = None) -> dict:
    ok = goals_svc.delete_goal(goal_id, owner=owner)
    if not ok:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"status": "deleted"}


# --- Baskets (research -> invest) endpoints -------------------------------
from app import baskets as baskets_svc  # noqa: E402
from app.schemas import (  # noqa: E402
    Basket,
    BasketCreate,
    BasketSuggestRequest,
    BasketSuggestResponse,
)


@app.post("/baskets/suggest", response_model=BasketSuggestResponse)
def suggest_basket(req: BasketSuggestRequest) -> BasketSuggestResponse:
    return baskets_svc.suggest(req.risk)


@app.get("/baskets/models")
def basket_models() -> list:
    """Three curated model baskets (conservative/balanced/aggressive)."""
    return baskets_svc.model_baskets()


@app.post("/baskets/derive", response_model=BasketSuggestResponse)
def derive_basket(prefs: dict) -> BasketSuggestResponse:
    """Derive a basket from hexagon preferences (returns/safety/stability/...)."""
    return baskets_svc.derive_from_prefs(prefs)


@app.post("/baskets/analyze")
def analyze_basket(payload: dict) -> dict:
    """Real blended-NAV metrics for a set of {scheme_code, weight} items.

    Pass include_series=true to also get the growth curve, drawdown curve and
    yearly returns (the visual evidence behind the numbers).
    """
    from app import basket_analytics

    items = payload.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="No items to analyze")
    include_series = bool(payload.get("include_series", False))
    return basket_analytics.analyze(items, include_series=include_series).model_dump()


@app.get("/dashboard/funds/{scheme_code}/info")
def fund_info(scheme_code: int) -> dict:
    """Beginner explainer + category-based composition for a fund."""
    from app import fund_info as fi

    fund = next((f for f in dashboard.all_funds() if f.scheme_code == scheme_code), None)
    if fund is None:
        raise HTTPException(status_code=404, detail="Fund not found")
    return fi.get_fund_info(fund.bucket).model_dump()


@app.get("/baskets", response_model=list)
def list_baskets(owner: Optional[str] = None, goal_id: Optional[str] = None) -> list:
    return [b.model_dump() for b in baskets_svc.list_baskets(owner=owner, goal_id=goal_id)]


@app.post("/baskets", response_model=Basket)
def create_basket(payload: BasketCreate) -> Basket:
    return baskets_svc.create_basket(payload)


@app.put("/baskets/{basket_id}", response_model=Basket)
def update_basket(basket_id: str, payload: BasketCreate) -> Basket:
    updated = baskets_svc.update_basket(basket_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Basket not found")
    return updated


@app.delete("/baskets/{basket_id}")
def delete_basket(basket_id: str, owner: Optional[str] = None) -> dict:
    baskets_svc.delete_basket(basket_id, owner=owner)
    return {"status": "deleted"}


# --- Auth endpoints -------------------------------------------------------
from fastapi import Header  # noqa: E402

from app import auth as auth_svc  # noqa: E402
from app import phone_auth as phone_svc  # noqa: E402
from app.schemas import AuthResponse, AuthUser, LoginRequest, PhoneAuthRequest, ProfileRequest, SignupRequest  # noqa: E402


@app.post("/auth/signup", response_model=AuthResponse)
def auth_signup(req: SignupRequest) -> dict:
    try:
        return auth_svc.signup(req.email, req.password, req.name or "")
    except auth_svc.AuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/login", response_model=AuthResponse)
def auth_login(req: LoginRequest) -> dict:
    try:
        return auth_svc.login(req.email, req.password)
    except auth_svc.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))


@app.post("/auth/phone", response_model=AuthResponse)
def auth_phone(req: PhoneAuthRequest) -> dict:
    """Sign in with a phone number after the client's Firebase OTP passes."""
    try:
        return phone_svc.login_with_phone(req.name or "", req.phone, req.id_token or "")
    except phone_svc.PhoneAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/auth/me")
def auth_me(authorization: Optional[str] = Header(default=None)) -> dict:
    token = authorization.replace("Bearer ", "", 1) if authorization else ""
    user = auth_svc.me(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@app.post("/auth/profile", response_model=AuthUser)
def auth_profile(
    req: ProfileRequest, authorization: Optional[str] = Header(default=None)
) -> dict:
    """Complete a signed-in (usually phone-verified) user's profile."""
    token = authorization.replace("Bearer ", "", 1) if authorization else ""
    owner = auth_svc.owner_from_token(token)
    if not owner:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return auth_svc.save_profile(owner, req.name, req.email, req.age, req.city)
    except auth_svc.AuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- Consultation bookings (plot reservation) ----------------------------
from fastapi import Request, Response  # noqa: E402

from app import bookings as bookings_svc  # noqa: E402
from app import admin_auth  # noqa: E402
from app import availability as availability_svc  # noqa: E402
from app import documents as documents_svc  # noqa: E402
from app.schemas import (  # noqa: E402
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


def _set_admin_cookie(resp: Response, raw: str) -> None:
    resp.set_cookie(
        admin_auth.DEVICE_COOKIE, raw,
        max_age=admin_auth.device_ttl_days() * 86400,
        httponly=True, secure=True, samesite="none", path="/",
    )


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
    response.delete_cookie(admin_auth.DEVICE_COOKIE, path="/", samesite="none", secure=True)
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
from fastapi import File, Form, UploadFile  # noqa: E402
from fastapi.responses import Response as RawResponse  # noqa: E402


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


# Serve the built Angular SPA (combined single-service deploy). Must be last
# so the catch-all route does not shadow the API endpoints above.
from app.static_spa import mount_spa  # noqa: E402

mount_spa(app)
