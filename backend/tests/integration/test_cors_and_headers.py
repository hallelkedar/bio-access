from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import app
from app.models.user import User, UserRole

MakeUser = Callable[..., User]
Headers = Callable[[User], dict[str, str]]
ALLOWED = get_settings().cors_origins_list[0]
EVIL = "https://evil.example"


def _preflight(client: TestClient, origin: str) -> httpx.Response:
    return client.options(
        "/api/events",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )


def test_preflight_from_frontend_allowed(client: TestClient) -> None:
    response = _preflight(client, ALLOWED)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED
    assert "access-control-allow-credentials" not in response.headers


def test_preflight_from_foreign_origin_blocked(client: TestClient) -> None:
    response = _preflight(client, EVIL)

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_foreign_origin_gets_no_permission_on_simple_request(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": EVIL})

    assert "access-control-allow-origin" not in response.headers


def test_retry_after_is_exposed_to_frontend(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": ALLOWED})

    assert "retry-after" in response.headers["access-control-expose-headers"].lower()


def test_security_headers_on_api(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    response = client.get("/api/auth/me", headers=auth_headers(make_user()))

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert response.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in response.headers  # plain HTTP


def test_docs_keep_working_without_strict_csp(client: TestClient) -> None:
    response = client.get("/docs")

    assert response.status_code == 200
    assert "content-security-policy" not in response.headers
    assert response.headers["x-content-type-options"] == "nosniff"


def test_hsts_only_over_https() -> None:
    with TestClient(app, base_url="https://testserver") as https_client:
        response = https_client.get("/health")

    assert response.headers["strict-transport-security"].startswith("max-age=")


def test_non_api_paths_not_forced_no_store(client: TestClient) -> None:
    assert "cache-control" not in client.get("/health").headers


# --- WebSocket origin ---------------------------------------------------------


def _ws_first_reply(client: TestClient, user: User, origin: str | None) -> object:
    headers = {"origin": origin} if origin else {}
    with client.websocket_connect("/ws/admin", headers=headers) as ws:
        ws.send_json({"type": "auth", "token": create_access_token(user.id, user.role)})
        try:
            return ws.receive_json()
        except WebSocketDisconnect as exc:
            return exc.code


def test_ws_foreign_origin_refused(client: TestClient, make_user: MakeUser) -> None:
    assert _ws_first_reply(client, make_user(UserRole.ADMIN), EVIL) == 4403


@pytest.mark.parametrize("origin", [ALLOWED, None])
def test_ws_allowed_or_missing_origin_connects(client: TestClient, make_user: MakeUser, origin: str | None) -> None:
    assert _ws_first_reply(client, make_user(UserRole.ADMIN), origin) == {"type": "connected", "payload": {}}
