"""Serve the built Angular SPA from FastAPI (combined single-service deploy).

The Angular production build is copied to STATIC_DIR at image-build time.
API routes (/health, /presets, /plan, /docs, /openapi.json) are registered
before this mount, so they take precedence. Everything else falls through to
index.html so client-side rendering works.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

# backend/app/static_spa.py -> backend/static
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


def mount_spa(app: FastAPI) -> None:
    index = os.path.join(STATIC_DIR, "index.html")
    if not os.path.isdir(STATIC_DIR) or not os.path.isfile(index):
        # No build present (e.g. local dev running API only) — skip silently.
        return

    # Serve hashed asset files directly.
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> Response:
        # Serve a real file if it exists (favicon, *.js, *.css, etc.)
        candidate = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        # Otherwise hand back the SPA shell.
        return FileResponse(index)
