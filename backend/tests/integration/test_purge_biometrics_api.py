from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
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


def _url(event_id: int) -> str:
    return f"/api/admin/events/{event_id}/purge-biometrics"


@pytest.fixture
def enrolled_event(db: Session, face_provider: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent) -> Event:
    """An ACTIVE event with one enrolled ticket."""
    event = make_event(EventStatus.ACTIVE, **live_window())
    collection_id = face_provider.ensure_collection(event.id)
    ticket = ticket_service.create_ticket(db, make_user(), event.id)
    ticket.status = TicketStatus.VALID
    face_id = face_provider.enroll(event.id, ticket.id, image_bytes("JPEG", (32, 32)))
    db.add(
        BiometricProfile(ticket_id=ticket.id, face_id=face_id, collection_id=collection_id, consent_at=datetime.now(UTC))
    )
    db.commit()
    return event


def test_purges_closed_event(
    client: TestClient,
    db: Session,
    face_provider: FakeFaceProvider,
    enrolled_event: Event,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    enrolled_event.status = EventStatus.CLOSED
    db.commit()

    response = client.post(_url(enrolled_event.id), headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 200
    assert response.json() == {"event_id": enrolled_event.id, "deleted_profiles": 1}
    assert face_provider.face_count(enrolled_event.id) == 0


def test_open_event_conflict(
    client: TestClient, face_provider: FakeFaceProvider, enrolled_event: Event, make_user: MakeUser, auth_headers: Headers
) -> None:
    response = client.post(_url(enrolled_event.id), headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 409
    assert face_provider.face_count(enrolled_event.id) == 1


def test_provider_down_is_503(
    client: TestClient,
    db: Session,
    face_provider: FakeFaceProvider,
    enrolled_event: Event,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    enrolled_event.status = EventStatus.CLOSED
    db.commit()
    face_provider.available = False

    response = client.post(_url(enrolled_event.id), headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 503


def test_unknown_event_404(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    response = client.post(_url(999_999), headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 404


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_only_admins(
    client: TestClient, enrolled_event: Event, make_user: MakeUser, auth_headers: Headers, role: UserRole
) -> None:
    response = client.post(_url(enrolled_event.id), headers=auth_headers(make_user(role)))

    assert response.status_code == 403


def test_requires_login(client: TestClient, enrolled_event: Event) -> None:
    assert client.post(_url(enrolled_event.id)).status_code == 401
