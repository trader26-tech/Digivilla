"""Write runtime frontend config into the served static bundle.

Runs at container start so a single built image can be promoted across
environments without a rebuild. Reads SUPABASE_URL / SUPABASE_ANON_KEY from the
environment. apiUrl is same-origin ("/api/v1") in the single-image deploy.

No-op when the static bundle is absent (API-only local runs).
"""

import json
import os
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent / "app" / "static" / "browser"


def main() -> None:
    assets = STATIC_DIR / "assets"
    if not assets.is_dir():
        return

    env = {
        "apiUrl": os.environ.get("API_URL", "/api/v1"),
        "supabaseUrl": os.environ.get("SUPABASE_URL", ""),
        "supabaseAnonKey": os.environ.get("SUPABASE_ANON_KEY", ""),
    }
    payload = f"window.__env = {json.dumps(env)};\n"
    (assets / "env.js").write_text(payload)
    print(f"Wrote runtime config to {assets / 'env.js'}")


if __name__ == "__main__":
    main()
