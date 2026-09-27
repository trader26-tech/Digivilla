"""Serve the built Angular SPA from FastAPI (combined single-service deploy).

The Angular production build is copied to STATIC_DIR at image-build time.
API routes (/health, /presets, /plan, /docs, /openapi.json) are registered
before this mount, so they take precedence. Everything else falls through to
index.html so client-side rendering works.
"""

from __future__ import annotations

import os
import re

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

    root = os.path.realpath(STATIC_DIR)
    # Angular's content-hashed build output (main-XXXX.js, chunk-XXXX.js,
    # styles-XXXX.css): the name changes whenever the content does, so browsers
    # may cache them forever. index.html must never be cached so a new deploy
    # (with new hashed names) is picked up on the next open.
    hashed = re.compile(r"-[A-Z0-9]{8}\.(js|css)$")
    immutable = {"Cache-Control": "public, max-age=31536000, immutable"}
    no_cache = {"Cache-Control": "no-cache"}

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> Response:
        # Serve a real file if it exists (favicon, *.js, *.css, etc.) — only
        # from inside the build folder (no ../ escapes).
        candidate = os.path.realpath(os.path.join(root, full_path))
        if full_path and candidate.startswith(root + os.sep) and os.path.isfile(candidate):
            headers = immutable if hashed.search(full_path) else (
                no_cache if full_path.endswith((".html", "ngsw.json", "env.js")) else None)
            return FileResponse(candidate, headers=headers)
        # Otherwise hand back the SPA shell.
        return FileResponse(index, headers=no_cache)
