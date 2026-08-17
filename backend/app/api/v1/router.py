from fastapi import APIRouter

from app.api.v1.routes import funds, health, users

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(users.router)
api_router.include_router(funds.router)
