"""Serve the built Angular SPA from the FastAPI app.

In the single-image deployment the Angular build is copied to
`app/static/browser` (see the root Dockerfile). This module mounts those files
and provides an index.html fallback so client-side routes resolve. When the
directory is absent (e.g. running the API alone in local dev), mounting is
skipped and only the API is served.
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

# app/static/browser  (relative to this file's app/ package)
STATIC_DIR = Path(__file__).resolve().parent / "static" / "browser"


def mount_spa(app: FastAPI, api_prefix: str) -> None:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        # No frontend bundled — API-only mode.
        return

    # Runtime config must never be cached, so serve it explicitly before the
    # StaticFiles mount (which would otherwise send caching headers).
    @app.get("/assets/env.js", include_in_schema=False)
    async def env_js() -> Response:
        return FileResponse(
            STATIC_DIR / "assets" / "env.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-store"},
        )

    # Serve hashed static assets (JS/CSS/images) directly.
    app.mount(
        "/assets",
        StaticFiles(directory=STATIC_DIR / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str, request: Request) -> Response:
        # Never shadow the API or docs — let those 404 via their own routers.
        if full_path.startswith(api_prefix.strip("/")) or full_path in {
            "docs",
            "redoc",
            "openapi.json",
        }:
            return Response(status_code=404)

        # Serve a real file if it exists (favicon.ico, env.js, etc.).
        candidate = (STATIC_DIR / full_path).resolve()
        if candidate.is_file() and STATIC_DIR in candidate.parents:
            # env.js and index must not be cached so config/deploys take effect.
            no_store = candidate.name in {"env.js", "index.html"}
            headers = {"Cache-Control": "no-store"} if no_store else {}
            return FileResponse(candidate, headers=headers)

        # Otherwise fall back to the SPA entrypoint for client-side routing.
        return FileResponse(index_file, headers={"Cache-Control": "no-store"})
