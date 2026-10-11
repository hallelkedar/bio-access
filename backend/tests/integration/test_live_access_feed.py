from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.testclient import WebSocketTestSession

from app.core.security import create_access_token
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider
from app.services import ticket as ticket_service
from tests.events import live_window
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]
FACE = image_bytes("JPEG", (32, 32))


@pytest.fixture
def setup(
    db: Session, make_user: MakeUser, make_event: MakeEvent, face_provider: FakeFaceProvider
) -> tuple[Event, Ticket, User]:
    user = make_user()
    event = make_event(EventStatus.ACTIVE, **live_window())
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()
    face_provider.ensure_collection(event.id)
    face_provider.enroll(event.id, ticket.id, FACE)
    return event, ticket, user


@pytest.fixture
def admin_feed(client: TestClient, make_user: MakeUser) -> Iterator[WebSocketTestSession]:
    admin = make_user(UserRole.ADMIN)
    with client.websocket_connect("/ws/admin") as ws:
        ws.send_json({"type": "auth", "token": create_access_token(admin.id, admin.role)})
        assert ws.receive_json()["type"] == "connected"
        yield ws


def _gatekeeper(make_user: MakeUser, auth_headers: Headers) -> dict[str, str]:
    return auth_headers(make_user(UserRole.GATEKEEPER))


def test_face_approval_reaches_admin(
    client: TestClient,
    admin_feed: WebSocketTestSession,
    setup: tuple[Event, Ticket, User],
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    event, ticket, user = setup
    headers = {**_gatekeeper(make_user, auth_headers), "Content-Type": "image/jpeg"}

    client.post(f"/api/gate/verify?event_id={event.id}&gate_id=north-1", content=FACE, headers=headers)

    message: dict[str, Any] = admin_feed.receive_json()
    assert message["type"] == "access_event"
    payload = message["payload"]
    assert payload["event_id"] == event.id
    assert payload["gate_id"] == "north-1"
    assert payload["method"] == "FACE"
    assert (payload["result"], payload["reason"]) == ("APPROVED", "NONE")
    assert (payload["ticket_id"], payload["user_name"]) == (ticket.id, user.full_name)
    assert payload["similarity"] >= 95
    assert payload["timestamp"]


def test_qr_denial_reaches_admin(
    client: TestClient,
    admin_feed: WebSocketTestSession,
    setup: tuple[Event, Ticket, User],
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    event, _, _ = setup

    client.post(
        "/api/gate/verify-qr",
        json={"event_id": event.id, "gate_id": "vip", "qr_token": "unknown-token"},
        headers=_gatekeeper(make_user, auth_headers),
    )

    payload = admin_feed.receive_json()["payload"]
    assert (payload["method"], payload["result"], payload["reason"]) == ("QR", "DENIED", "NOT_RECOGNIZED")
    assert payload["ticket_id"] is None
