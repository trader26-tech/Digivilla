"""The calculator SETTINGS, for the admin — the SAME module the client backend
uses (client/backend/app/calc_config.py), not a copy: validation, the live copy
in Supabase Storage, versions and history are shared. In the Docker image the
file is copied to /app/shared/calc_config.py; locally it's imported from the
client backend in the repo.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_CANDIDATES = [
    Path(__file__).resolve().parents[1] / "shared" / "calc_config.py",                       # docker
    Path(__file__).resolve().parents[3] / "client" / "backend" / "app" / "calc_config.py",   # repo
]


def _load():
    for p in _CANDIDATES:
        if p.exists():
            spec = importlib.util.spec_from_file_location("dv_calc_config", p)
            mod = importlib.util.module_from_spec(spec)
            sys.modules["dv_calc_config"] = mod
            spec.loader.exec_module(mod)
            # its fallback default lives next to it (data/calc_config.json)
            from app.supabase_client import get_supabase
            mod.use_supabase(get_supabase)
            return mod
    raise ImportError("calc_config.py not found (expected client/backend/app/calc_config.py or /app/shared/calc_config.py)")


calc_config = _load()
