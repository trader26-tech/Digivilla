from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Admin API configuration loaded from environment / .env file.

    Shares the SAME Supabase database as the client backend so a booking
    confirmed here is instantly reflected in the client app. Supabase is
    optional: without it, bookings/availability/documents fall back to local
    JSON files, so the API runs out of the box in development.
    """

    supabase_url: Optional[str] = None
    supabase_service_key: Optional[str] = None

    # Allowed frontend origins for CORS. The admin SPA and the client SPA both
    # call this API cross-origin, so both origins must be permitted.
    cors_origins: str = (
        "http://localhost:4200,http://127.0.0.1:4200,"
        "http://localhost:4300,http://127.0.0.1:4300"
    )
    # Regex to additionally allow deploy origins (e.g. Railway subdomains).
    cors_origin_regex: Optional[str] = r"https://.*\.up\.railway\.app"

    # --- Admin OTP → PIN sign-in ---
    # Secret used to sign admin session tokens (change in production).
    admin_token_secret: str = "dev-admin-insecure-change-me"
    # Comma-separated allowlist of emails permitted to request a sign-in code.
    # The first entry is the default (single-admin: code always goes here).
    otp_allowlist: str = "ranjeevfortrade@gmail.com"
    # Resend API key for delivering the code; if unset, the code is printed to
    # the server log (dev), so the flow is testable without credentials.
    resend_api_key: Optional[str] = None
    otp_from: str = "onboarding@resend.dev"
    # Trusted-device lifetime (the httpOnly cookie) and idle auto-lock window.
    device_ttl_days: int = 30
    default_lock_minutes: int = 30
    # Device-cookie SameSite policy. "lax" for the same-origin combined deploy
    # (persists reliably, incl. iOS PWA). Use "none" (forces Secure) only if the
    # admin SPA is served from a different origin than this API.
    cookie_samesite: str = "lax"
    cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> "list[str]":
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
