import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AuthUser, get_current_user
from app.db.session import get_db
from app.schemas.user import UserRead, UserUpdate
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def read_me(
    current: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Return the current user's profile, creating it on first access."""
    user = await user_service.upsert_profile(
        db,
        user_id=uuid.UUID(current.id),
        email=current.email or "",
        full_name=current.claims.get("user_metadata", {}).get("full_name"),
    )
    return user


@router.patch("/me", response_model=UserRead)
async def update_me(
    data: UserUpdate,
    current: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await user_service.get_user(db, uuid.UUID(current.id))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return await user_service.update_user(db, user, data)
