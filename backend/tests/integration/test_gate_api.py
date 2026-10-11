import builtins
import tempfile
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider
from app.services import ticket as ticket_service
from tests.images import image_bytes, noise_png

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]

FACE = image_bytes("JPEG", (32, 32))


@pytest.fixture
def setup(
    db: Session, make_user: MakeUser, make_event: MakeEvent, face_provider: FakeFaceProvider
) -> tuple[Event, Ticket, User]:
    user = make_user()
    event = make_event(EventStatus.ACTIVE)
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()
    face_provider.ensure_collection(event.id)
    face_provider.enroll(event.id, ticket.id, FACE)
    return event, ticket, user


def _verify(client: TestClient, event_id: int, headers: dict[str, str], body: bytes = FACE) -> Any:
    return client.post(
        f"/api/gate/verify?event_id={event_id}&gate_id=north-1",
        content=body,
        headers={**headers, "Content-Type": "image/jpeg"},
    )


def test_enrolled_person_approved(
    client: TestClient, setup: tuple[Event, Ticket, User], make_user: MakeUser, auth_headers: Headers
) -> None:
    event, ticket, user = setup

    response = _verify(client, event.id, auth_headers(make_user(UserRole.GATEKEEPER)))

    assert response.status_code == 200
    body = response.json()
    assert body["result"] == "APPROVED"
    assert body["reason"] == "NONE"
    assert body["ticket_id"] == ticket.id
    assert body["user_name"] == user.full_name


def test_stranger_denied_with_200(
    client: TestClient, setup: tuple[Event, Ticket, User], make_user: MakeUser, auth_headers: Headers
) -> None:
    event, _, _ = setup

    response = _verify(client, event.id, auth_headers(make_user(UserRole.GATEKEEPER)), body=image_bytes("PNG"))

    assert response.status_code == 200
    assert response.json()["result"] == "DENIED"
    assert response.json()["reason"] == "NOT_RECOGNIZED"


def test_provider_down_is_a_decision(
    client: TestClient,
    setup: tuple[Event, Ticket, User],
    make_user: MakeUser,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    event, _, _ = setup
    face_provider.available = False

    response = _verify(client, event.id, auth_headers(make_user(UserRole.GATEKEEPER)))

    assert response.status_code == 200
    assert response.json()["reason"] == "PROVIDER_ERROR"


def test_unknown_event_returns_404(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    assert _verify(client, 999_999, auth_headers(make_user(UserRole.GATEKEEPER))).status_code == 404


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.ADMIN])
def test_only_gatekeepers(
    client: TestClient, setup: tuple[Event, Ticket, User], make_user: MakeUser, auth_headers: Headers, role: UserRole
) -> None:
    event, _, _ = setup

    assert _verify(client, event.id, auth_headers(make_user(role))).status_code == 403


def test_gate_id_required(
    client: TestClient, setup: tuple[Event, Ticket, User], make_user: MakeUser, auth_headers: Headers
) -> None:
    event, _, _ = setup
    response = client.post(
        f"/api/gate/verify?event_id={event.id}", content=FACE, headers=auth_headers(make_user(UserRole.GATEKEEPER))
    )

    assert response.status_code == 422


def test_frame_never_written_to_disk(
    client: TestClient,
    setup: tuple[Event, Ticket, User],
    make_user: MakeUser,
    auth_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event, _, _ = setup
    headers = auth_headers(make_user(UserRole.GATEKEEPER))
    big_frame = noise_png((650, 650))  # > 1 MB
    real_open = builtins.open

    def no_write_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if any(flag in mode for flag in "wax+"):
            raise AssertionError(f"file write attempted: {file!r}")
        return real_open(file, mode, *args, **kwargs)

    def no_tempfile(*_: Any, **__: Any) -> Any:
        raise AssertionError("temp file created")

    monkeypatch.setattr(builtins, "open", no_write_open)
    for name in ("SpooledTemporaryFile", "NamedTemporaryFile", "TemporaryFile", "mkstemp"):
        monkeypatch.setattr(tempfile, name, no_tempfile)

    response = _verify(client, event.id, headers, body=big_frame)

    assert response.status_code == 200
    assert response.json()["reason"] == "NOT_RECOGNIZED"
