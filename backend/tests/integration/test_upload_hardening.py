import asyncio
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.body_limit import BodySizeLimitMiddleware
from app.models.event import Event
from app.models.user import User, UserRole
from tests import malicious
from tests.fakes import InMemoryStorage

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


def _upload_cover(client: TestClient, event_id: int, headers: dict[str, str], data: bytes, name: str) -> Any:
    return client.post(f"/api/events/{event_id}/cover", files={"file": (name, data, "image/png")}, headers=headers)


@pytest.mark.parametrize(
    ("payload", "name"),
    [
        (malicious.svg_with_script(), "cover.svg"),
        (malicious.html_page(), "cover.png"),
        (malicious.zip_archive(), "cover.jpg"),
        (malicious.decompression_bomb_png(), "cover.png"),
    ],
    ids=["svg-script", "html-renamed", "zip-renamed", "decompression-bomb"],
)
def test_hostile_cover_rejected_and_not_stored(
    client: TestClient,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    storage: InMemoryStorage,
    payload: bytes,
    name: str,
) -> None:
    response = _upload_cover(client, make_event().id, auth_headers(make_user(UserRole.ADMIN)), payload, name)

    assert response.status_code == 415
    assert storage.files == {}


def test_polyglot_and_exif_are_stored_clean(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers, storage: InMemoryStorage
) -> None:
    headers = auth_headers(make_user(UserRole.ADMIN))
    event = make_event()

    assert _upload_cover(client, event.id, headers, malicious.polyglot_jpeg(), "a.jpg").status_code == 200
    assert _upload_cover(client, event.id, headers, malicious.jpeg_with_metadata(), "b.jpg").status_code == 200

    stored = b"".join(data for data, _ in storage.files.values())
    assert b"<script>" not in stored
    assert b"secret-location" not in stored


@pytest.mark.parametrize("content_type", ["text/plain", "application/octet-stream", "image/webp", ""])
def test_raw_image_routes_require_jpeg_or_png_content_type(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, content_type: str
) -> None:
    headers = {**auth_headers(make_user()), "Content-Type": content_type}

    response = client.post("/api/enrollment?ticket_id=1&consent=true", content=b"x", headers=headers)

    assert response.status_code == 415


def test_chunked_oversized_body_is_cut_off(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    def chunks() -> Iterator[bytes]:  # no Content-Length: streamed as chunked
        for _ in range(40):
            yield b"\0" * (128 * 1024)  # 5 MB in total, over the 2 MB + overhead cap

    headers = {**auth_headers(make_user(UserRole.ADMIN)), "Content-Type": "multipart/form-data; boundary=x"}

    response = client.post("/api/events/1/cover", content=chunks(), headers=headers)

    assert response.status_code == 413


def test_huge_declared_length_rejected_without_reading() -> None:
    called = False

    async def app(scope: Any, receive: Any, send: Any) -> None:
        nonlocal called
        called = True

    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        raise AssertionError("body must not be read")

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {"type": "http", "headers": [(b"content-length", b"3000000000")]}
    asyncio.run(BodySizeLimitMiddleware(app, max_bytes=1024)(scope, receive, send))

    assert not called
    assert sent[0]["status"] == 413
