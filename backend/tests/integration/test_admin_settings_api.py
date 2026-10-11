from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider
from app.services import ticket as ticket_service
from tests.events import live_window
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]
URL = "/api/admin/settings"


def test_get_default(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    response = client.get(URL, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 200
    assert response.json()["source"] == "default"


def test_put_then_get(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    headers = auth_headers(make_user(UserRole.ADMIN))

    put = client.put(URL, json={"face_match_threshold": 97.5}, headers=headers)

    assert put.status_code == 200
    body = client.get(URL, headers=headers).json()
    assert (body["face_match_threshold"], body["source"]) == (97.5, "database")


@pytest.mark.parametrize("value", [79.9, 100.1, -1])
def test_out_of_range_rejected(client: TestClient, make_user: MakeUser, auth_headers: Headers, value: float) -> None:
    response = client.put(URL, json={"face_match_threshold": value}, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 422


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_only_admins(client: TestClient, make_user: MakeUser, auth_headers: Headers, role: UserRole) -> None:
    headers = auth_headers(make_user(role))

    assert client.get(URL, headers=headers).status_code == 403
    assert client.put(URL, json={"face_match_threshold": 95}, headers=headers).status_code == 403


def test_new_threshold_affects_next_gate_search(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    face = image_bytes("JPEG", (32, 32))
    event = make_event(EventStatus.ACTIVE, **live_window())
    first, second = (ticket_service.create_ticket(db, make_user(), event.id) for _ in range(2))
    first.status = second.status = TicketStatus.VALID
    db.commit()
    other_face = image_bytes("PNG", (32, 32))
    face_provider.ensure_collection(event.id)
    face_provider.enroll(event.id, first.id, face)
    face_provider.enroll(event.id, second.id, other_face)  # fake similarity: 99.9
    gate = {**auth_headers(make_user(UserRole.GATEKEEPER)), "Content-Type": "image/jpeg"}
    verify = f"/api/gate/verify?event_id={event.id}&gate_id=north-1"

    assert client.post(verify, content=face, headers=gate).json()["result"] == "APPROVED"

    client.put(URL, json={"face_match_threshold": 100}, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert client.post(verify, content=other_face, headers=gate).json()["reason"] == "NOT_RECOGNIZED"
