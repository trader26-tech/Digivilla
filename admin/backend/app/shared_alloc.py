"""The villa allocation rule, SHARED with the client backend — the same file
(client/backend/app/villa_alloc.py), not a copy, so both apps place the same
money in the same villas. In the Docker image it is copied to
/app/shared/villa_alloc.py; locally it is imported from the repo."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
_CANDIDATES = [_HERE.parents[1] / "shared" / "villa_alloc.py"]                          # docker: /app/shared
if len(_HERE.parents) > 3:                                                               # the repo (local dev)
    _CANDIDATES.append(_HERE.parents[3] / "client" / "backend" / "app" / "villa_alloc.py")


def _load():
    for p in _CANDIDATES:
        if p.exists():
            spec = importlib.util.spec_from_file_location("dv_villa_alloc", p)
            mod = importlib.util.module_from_spec(spec)
            sys.modules["dv_villa_alloc"] = mod
            spec.loader.exec_module(mod)
            return mod
    raise ImportError("villa_alloc.py not found (expected client/backend/app/villa_alloc.py or /app/shared/villa_alloc.py)")


villa_alloc = _load()
