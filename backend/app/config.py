from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment / .env file.

    Supabase is optional: without it, the planner falls back to the built-in
    fund universe in app/funds.py, so the app runs out of the box.
    """

    supabase_url: Optional[str] = None
    supabase_service_key: Optional[str] = None
    # Secret used to sign auth tokens. Override in production via env; the
    # dev default keeps the app working out of the box.
    auth_secret: str = "dev-insecure-change-me"
    # Default to both localhost and 127.0.0.1 so the Angular dev server works
    # regardless of which host name the browser uses.
    cors_origins: str = (
        "http://localhost:4200,http://127.0.0.1:4200"
    )
    # Regex to additionally allow deploy origins (e.g. Railway subdomains).
    cors_origin_regex: Optional[str] = r"https://.*\.up\.railway\.app"
    # Phone/OTP sign-in: require a verified Firebase ID token by default (secure).
    # Set ALLOW_UNVERIFIED_PHONE=true in the env for local dev when Firebase
    # Admin isn't configured, to trust the client-supplied phone instead.
    allow_unverified_phone: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> "list[str]":
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
