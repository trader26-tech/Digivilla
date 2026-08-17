from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.mutual_fund import NavHistory, Scheme
from app.schemas.mutual_fund import (
    FacetResponse,
    NavPoint,
    SchemeDetail,
    SchemeListResponse,
    SchemeSummary,
    StatsResponse,
)
from app.services import mf_analytics, mf_ingest

router = APIRouter(prefix="/funds", tags=["funds"])


@router.get("", response_model=SchemeListResponse)
async def list_schemes(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="Search scheme name / fund house"),
    fund_house: str | None = None,
    category: str | None = None,
    plan: str | None = Query(None, description="DIRECT | REGULAR"),
    option: str | None = Query(None, description="GROWTH | IDCW"),
    sort: str = Query("name", pattern="^(name|nav|nav_date)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> SchemeListResponse:
    filters = []
    if q:
        like = f"%{q}%"
        filters.append(or_(Scheme.scheme_name.ilike(like), Scheme.fund_house.ilike(like)))
    if fund_house:
        filters.append(Scheme.fund_house == fund_house)
    if category:
        filters.append(Scheme.scheme_category == category)
    if plan:
        filters.append(Scheme.plan == plan.upper())
    if option:
        filters.append(Scheme.option == option.upper())

    base = select(Scheme)
    for f in filters:
        base = base.where(f)

    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )

    order = {
        "name": Scheme.scheme_name.asc(),
        "nav": Scheme.latest_nav.desc().nulls_last(),
        "nav_date": Scheme.latest_nav_date.desc().nulls_last(),
    }[sort]

    rows = (
        await db.execute(base.order_by(order).offset(offset).limit(limit))
    ).scalars().all()

    return SchemeListResponse(
        total=total or 0,
        limit=limit,
        offset=offset,
        items=[SchemeSummary.model_validate(r) for r in rows],
    )


@router.get("/facets", response_model=FacetResponse)
async def facets(db: AsyncSession = Depends(get_db)) -> FacetResponse:
    houses = (
        await db.execute(
            select(distinct(Scheme.fund_house))
            .where(Scheme.fund_house.is_not(None))
            .order_by(Scheme.fund_house)
        )
    ).scalars().all()
    categories = (
        await db.execute(
            select(distinct(Scheme.scheme_category))
            .where(Scheme.scheme_category.is_not(None))
            .order_by(Scheme.scheme_category)
        )
    ).scalars().all()
    return FacetResponse(fund_houses=list(houses), categories=list(categories))


@router.get("/stats", response_model=StatsResponse)
async def stats(db: AsyncSession = Depends(get_db)) -> StatsResponse:
    total_schemes = await db.scalar(select(func.count()).select_from(Scheme)) or 0
    total_houses = await db.scalar(
        select(func.count(distinct(Scheme.fund_house)))
    ) or 0
    total_categories = await db.scalar(
        select(func.count(distinct(Scheme.scheme_category)))
    ) or 0
    latest_date = await db.scalar(select(func.max(Scheme.latest_nav_date)))
    nav_points = await db.scalar(select(func.count()).select_from(NavHistory)) or 0
    return StatsResponse(
        total_schemes=total_schemes,
        total_fund_houses=total_houses,
        total_categories=total_categories,
        latest_nav_date=latest_date,
        nav_history_points=nav_points,
    )


async def _load_series(db: AsyncSession, scheme_code: int) -> list[tuple]:
    rows = (
        await db.execute(
            select(NavHistory.date, NavHistory.nav)
            .where(NavHistory.scheme_code == scheme_code)
            .order_by(NavHistory.date.asc())
        )
    ).all()
    return [(d, n) for d, n in rows]


@router.get("/{scheme_code}", response_model=SchemeDetail)
async def scheme_detail(
    scheme_code: int, db: AsyncSession = Depends(get_db)
) -> SchemeDetail:
    scheme = await db.get(Scheme, scheme_code)
    if scheme is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheme not found")

    # Lazily backfill history on first view (or if stale > 1 day).
    stale = (
        scheme.history_synced_at is None
        or scheme.history_synced_at < datetime.utcnow() - timedelta(days=1)
    )
    if stale:
        try:
            await mf_ingest.sync_scheme_history(db, scheme_code)
        except Exception:  # noqa: BLE001 - history is best-effort
            pass

    series = await _load_series(db, scheme_code)
    detail = SchemeDetail.model_validate(scheme)
    detail.metrics = mf_analytics.compute_metrics(series)
    return detail


@router.get("/{scheme_code}/nav", response_model=list[NavPoint])
async def scheme_nav_history(
    scheme_code: int,
    db: AsyncSession = Depends(get_db),
    range: str = Query("all", pattern="^(1m|3m|6m|1y|3y|5y|all)$"),
) -> list[NavPoint]:
    scheme = await db.get(Scheme, scheme_code)
    if scheme is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheme not found")

    if scheme.history_synced_at is None:
        try:
            await mf_ingest.sync_scheme_history(db, scheme_code)
        except Exception:  # noqa: BLE001
            pass

    stmt = select(NavHistory.date, NavHistory.nav).where(
        NavHistory.scheme_code == scheme_code
    )
    days = {"1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 1095, "5y": 1825}.get(range)
    if days and scheme.latest_nav_date:
        stmt = stmt.where(NavHistory.date >= scheme.latest_nav_date - timedelta(days=days))

    rows = (await db.execute(stmt.order_by(NavHistory.date.asc()))).all()
    return [NavPoint(date=d, nav=n) for d, n in rows]


@router.post("/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_catalog(db: AsyncSession = Depends(get_db)) -> dict[str, int | str]:
    """Manually trigger an AMFI catalog refresh."""
    count = await mf_ingest.sync_catalog(db)
    return {"status": "ok", "schemes_synced": count}
