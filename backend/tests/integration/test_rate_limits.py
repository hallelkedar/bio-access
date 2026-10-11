from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.models.event import Event, EventStatus
from app.models.user import User, UserRole
from tests.events import live_window

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


def test_login_limited_per_ip(client: TestClient) -> None:
    body = {"email": "nobody@example.com", "password": "wrong-password"}
    statuses = [client.post("/api/auth/login", json=body).status_code for _ in range(11)]

    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


def test_429_has_retry_after(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "auth_rate_limit", "1/minute")
    body = {"email": "nobody@example.com", "password": "wrong-password"}
    client.post("/api/auth/login", json=body)

    response = client.post("/api/auth/login", json=body)

    assert response.status_code == 429
    assert response.json() == {"detail": "rate limit exceeded"}
    assert response.headers["retry-after"] == "60"


def test_register_limited(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "auth_rate_limit", "2/minute")

    def register(n: int) -> int:
        body = {"email": f"rl{n}@example.com", "full_name": "R", "password": "password123"}
        return client.post("/api/auth/register", json=body).status_code

    assert [register(n) for n in range(3)] == [201, 201, 429]


def _qr(client: TestClient, event_id: int, headers: dict[str, str]) -> int:
    body = {"event_id": event_id, "gate_id": "north-1", "qr_token": "unknown"}
    return client.post("/api/gate/verify-qr", json=body, headers=headers).status_code


def test_gate_budget_is_per_gatekeeper_and_shared_by_face_and_qr(
    client: TestClient,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "gate_rate_limit", "2/minute")
    event = make_event(EventStatus.ACTIVE, **live_window())
    first = auth_headers(make_user(UserRole.GATEKEEPER))
    second = auth_headers(make_user(UserRole.GATEKEEPER))

    face = client.post(
        f"/api/gate/verify?event_id={event.id}&gate_id=north-1",
        content=b"not-an-image",
        headers={**first, "Content-Type": "image/jpeg"},
    )
    assert face.status_code == 200  # 1st request of `first` (face)
    assert _qr(client, event.id, first) == 200  # 2nd (QR, same budget)
    assert _qr(client, event.id, first) == 429  # over the limit
    assert _qr(client, event.id, second) == 200  # another gate (same IP) is unaffected
