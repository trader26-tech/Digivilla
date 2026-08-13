from functools import lru_cache
from typing import Annotated, List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    On Railway these come from the service's Variables. Locally they come
    from backend/.env (see .env.example).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    PROJECT_NAME: str = "Retirement API"
    API_V1_PREFIX: str = "/api/v1"
    ENVIRONMENT: str = "development"  # development | staging | production
    DEBUG: bool = False

    # --- Database (Supabase Postgres) ---
    # Use the Supabase "Connection string" (Transaction pooler, port 6543) for
    # serverless-style deploys, or the direct connection (port 5432).
    # Must be an async URL: postgresql+asyncpg://...
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"
    )

    # --- Supabase ---
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    # JWT secret used by Supabase Auth to sign access tokens (Project Settings > API).
    SUPABASE_JWT_SECRET: str = ""

    # --- CORS ---
    # Comma-separated list of allowed origins, e.g. "http://localhost:4200,https://app.example.com"
    # NoDecode disables pydantic-settings' JSON pre-parse so a plain comma string
    # is accepted (not just a JSON array); the validator below splits it.
    BACKEND_CORS_ORIGINS: Annotated[List[str], NoDecode] = ["http://localhost:4200"]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
