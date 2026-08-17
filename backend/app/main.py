import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import engine
from app.services import mf_scheduler
from app.static import mount_spa


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the MF catalog in the background so startup isn't blocked by the
    # AMFI fetch, then start the daily refresh scheduler.
    asyncio.create_task(mf_scheduler.seed_if_empty())
    mf_scheduler.start_scheduler()
    yield
    # Graceful shutdown.
    mf_scheduler.shutdown_scheduler()
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    debug=settings.DEBUG,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/docs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)

# Serve the built Angular SPA (single-image deploy). Registered last so it only
# handles routes the API router didn't claim. No-op if no frontend is bundled.
mount_spa(app, api_prefix=settings.API_V1_PREFIX)
