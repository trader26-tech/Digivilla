"""Per-client document vault.

The admin keeps important documents (agreements, IDs, plans) grouped by client
so they don't have to re-reference them each time. A "client" here is just a
named folder; documents are files attached to it.

Storage:
  • File bytes → Supabase Storage bucket `client-docs` when configured, else a
    local `app/data/client_docs/` directory.
  • Metadata (client name, filename, size, type, storage path) → Supabase table
    `admin_documents`, else `app/data/admin_documents.json`.

Everything degrades to local disk so dev works with zero setup, mirroring the
dual-store pattern used across the backend.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_FILES_DIR = os.path.join(_DATA_DIR, "client_docs")
_META_JSON = os.path.join(_DATA_DIR, "admin_documents.json")

_META_TABLE = "admin_documents"
_BUCKET = "client-docs"


# ── storage helpers ──────────────────────────────────────────────────────────
_TABLE_OK = None  # None = unprobed


def _use_supabase() -> bool:
    """True only when Supabase is configured AND the admin_documents table
    exists; otherwise fall back to local disk (see bookings.py for the pattern)."""
    global _TABLE_OK
    if _TABLE_OK is not None:
        return _TABLE_OK
    try:
        from app.supabase_client import get_supabase

        get_supabase().table(_META_TABLE).select("id").limit(1).execute()
        _TABLE_OK = True
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in (_META_TABLE, "does not exist", "pgrst205",
                                  "schema cache", "could not find", "not configured")):
            _TABLE_OK = False
        else:
            return False
    return _TABLE_OK


def _load() -> list[dict]:
    try:
        with open(_META_JSON, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(rows: list[dict]) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = _META_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _META_JSON)


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "client"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── operations ───────────────────────────────────────────────────────────────
def list_clients() -> list[dict]:
    """Every client that has at least one document, with counts. The admin can
    also create empty clients (stored as a 0-byte marker row)."""
    rows = _all_meta()
    by_client: dict[str, dict] = {}
    for r in rows:
        name = r.get("client") or "Unnamed"
        g = by_client.setdefault(name, {"client": name, "count": 0, "updated": ""})
        if not r.get("placeholder"):
            g["count"] += 1
        if r.get("created_at", "") > g["updated"]:
            g["updated"] = r.get("created_at", "")
    return sorted(by_client.values(), key=lambda g: g["client"].lower())


def create_client(name: str) -> dict:
    """Register an (empty) client folder so it shows up before any upload."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Client name is required.")
    existing = {c["client"].lower() for c in list_clients()}
    if name.lower() in existing:
        return {"client": name, "count": 0, "updated": ""}
    row = {
        "id": uuid.uuid4().hex, "client": name, "filename": "",
        "size": 0, "content_type": "", "path": "",
        "placeholder": True, "created_at": _now_iso(),
    }
    _insert(row)
    return {"client": name, "count": 0, "updated": row["created_at"]}


def list_documents(client: str) -> list[dict]:
    rows = [r for r in _all_meta()
            if (r.get("client") or "") == client and not r.get("placeholder")]
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return [_public(r) for r in rows]


def add_document(client: str, filename: str, content: bytes, content_type: str) -> dict:
    client = (client or "").strip()
    filename = (filename or "file").strip()
    if not client:
        raise ValueError("Client name is required.")
    doc_id = uuid.uuid4().hex
    path = f"{_slug(client)}/{doc_id}-{_slug(filename)[:60]}{_ext(filename)}"

    if _use_supabase():
        from app.supabase_client import get_supabase

        cl = get_supabase()
        _ensure_bucket(cl)
        try:
            cl.storage.from_(_BUCKET).upload(
                path, content,
                {"content-type": content_type or "application/octet-stream", "upsert": "true"},
            )
        except Exception as e:
            # Surface a clear error instead of silently "succeeding" into a
            # bucket that isn't there — the admin needs to know the upload failed.
            raise ValueError(f"Could not store the file in Supabase: {e}")
    else:
        os.makedirs(os.path.join(_FILES_DIR, _slug(client)), exist_ok=True)
        with open(os.path.join(_FILES_DIR, path), "wb") as fh:
            fh.write(content)

    row = {
        "id": doc_id, "client": client, "filename": filename,
        "size": len(content), "content_type": content_type or "",
        "path": path, "placeholder": False, "created_at": _now_iso(),
    }
    _insert(row)
    return _public(row)


def get_document(doc_id: str) -> tuple[dict, bytes] | None:
    row = next((r for r in _all_meta() if r.get("id") == doc_id), None)
    if not row or row.get("placeholder"):
        return None
    path = row.get("path", "")
    if _use_supabase():
        from app.supabase_client import get_supabase

        cl = get_supabase()
        try:
            data = cl.storage.from_(_BUCKET).download(path)
        except Exception:
            # Storage miss (e.g. uploaded before the bucket existed). Fall back
            # to the local copy if this instance happens to have it, so an old
            # doc still opens; otherwise report not-found.
            full = os.path.join(_FILES_DIR, path)
            if os.path.exists(full):
                with open(full, "rb") as fh:
                    return row, fh.read()
            return None
    else:
        full = os.path.join(_FILES_DIR, path)
        if not os.path.exists(full):
            return None
        with open(full, "rb") as fh:
            data = fh.read()
    return row, data


def delete_document(doc_id: str) -> bool:
    rows = _all_meta()
    row = next((r for r in rows if r.get("id") == doc_id), None)
    if not row:
        return False
    path = row.get("path", "")
    if _use_supabase():
        from app.supabase_client import get_supabase

        cl = get_supabase()
        try:
            if path:
                cl.storage.from_(_BUCKET).remove([path])
        except Exception:
            pass
        cl.table(_META_TABLE).delete().eq("id", doc_id).execute()
    else:
        full = os.path.join(_FILES_DIR, path) if path else ""
        if full and os.path.exists(full):
            try:
                os.remove(full)
            except Exception:
                pass
        _save([r for r in rows if r.get("id") != doc_id])
    return True


# ── metadata store (Supabase table or JSON) ──────────────────────────────────
def _all_meta() -> list[dict]:
    if _use_supabase():
        try:
            from app.supabase_client import get_supabase

            return get_supabase().table(_META_TABLE).select("*").execute().data or []
        except Exception:
            return []
    return _load()


def _insert(row: dict) -> None:
    if _use_supabase():
        from app.supabase_client import get_supabase

        get_supabase().table(_META_TABLE).insert(row).execute()
    else:
        rows = _load()
        rows.append(row)
        _save(rows)


_BUCKET_OK = False


def _ensure_bucket(cl) -> None:
    """Make sure the private `client-docs` bucket exists. Checked once per
    process, tolerant of the differing create_bucket signatures across
    supabase-py versions, and a no-op if the bucket is already there."""
    global _BUCKET_OK
    if _BUCKET_OK:
        return
    # Already exists?
    try:
        cl.storage.get_bucket(_BUCKET)
        _BUCKET_OK = True
        return
    except Exception:
        pass
    # Create it — try the current options-dict form, then older signatures.
    for attempt in (
        lambda: cl.storage.create_bucket(_BUCKET, options={"public": False}),
        lambda: cl.storage.create_bucket(_BUCKET, {"public": False}),
        lambda: cl.storage.create_bucket(_BUCKET),
    ):
        try:
            attempt()
            _BUCKET_OK = True
            return
        except Exception as e:
            # "already exists" means we're done; anything else, try the next form.
            if "exist" in str(e).lower() or "duplicate" in str(e).lower():
                _BUCKET_OK = True
                return
    # Couldn't confirm; leave _BUCKET_OK False so we retry next upload.


def _public(row: dict) -> dict:
    return {
        "id": row.get("id", ""),
        "client": row.get("client", ""),
        "filename": row.get("filename", ""),
        "size": int(row.get("size", 0) or 0),
        "content_type": row.get("content_type", ""),
        "created_at": row.get("created_at", ""),
    }


def _ext(filename: str) -> str:
    _, ext = os.path.splitext(filename or "")
    return ext[:12]
