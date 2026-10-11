from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.user import User, UserRole
from tests.fakes import InMemoryStorage
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


def _upload(client: TestClient, event_id: int, headers: dict[str, str], data: bytes, name: str = "cover.png") -> httpx.Response:
    return client.post(f"/api/events/{event_id}/cover", files={"file": (name, data, "image/png")}, headers=headers)


def test_admin_uploads_cover(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers, storage: InMemoryStorage
) -> None:
    event = make_event()

    response = _upload(client, event.id, auth_headers(make_user(UserRole.ADMIN)), image_bytes())

    assert response.status_code == 200
    url = response.json()["cover_image_url"]
    assert url.startswith(f"https://storage.test/event-covers/{event.id}/")
    assert len(storage.files) == 1


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_non_admin_forbidden(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers, role: UserRole
) -> None:
    response = _upload(client, make_event().id, auth_headers(make_user(role)), image_bytes())

    assert response.status_code == 403


def test_fake_image_returns_415(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers, storage: InMemoryStorage
) -> None:
    response = _upload(client, make_event().id, auth_headers(make_user(UserRole.ADMIN)), b"#!/bin/sh\nrm -rf /", "evil.png")

    assert response.status_code == 415
    assert storage.files == {}


def test_too_large_returns_413(
    client: TestClient,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)  # every non-empty file is too big

    response = _upload(client, make_event().id, auth_headers(make_user(UserRole.ADMIN)), image_bytes())

    assert response.status_code == 413


def test_unknown_event_returns_404(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    response = _upload(client, 999_999, auth_headers(make_user(UserRole.ADMIN)), image_bytes())

    assert response.status_code == 404
