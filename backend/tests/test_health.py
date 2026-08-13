from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_serves_spa_or_api_only():
    """/ serves the SPA when a frontend is bundled, else 404 (API-only)."""
    resp = client.get("/")
    assert resp.status_code in (200, 404)
