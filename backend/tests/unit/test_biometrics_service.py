from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User, UserRole
from app.providers.face.base import CollectionNotFoundError, FaceProviderError
from app.providers.face.fake import FakeFaceProvider
from app.services import biometrics
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError
from tests.events import live_window
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


@pytest.fixture
def faces() -> FakeFaceProvider:
    return FakeFaceProvider()


def _enroll_tickets(db: Session, faces: FakeFaceProvider, make_user: MakeUser, event: Event, count: int) -> None:
    """Enrolled tickets as the enrollment service leaves them: a face in the collection + our reference."""
    collection_id = faces.ensure_collection(event.id)
    event.face_collection_id = collection_id
    for n in range(count):
        ticket = ticket_service.create_ticket(db, make_user(), event.id)
        ticket.status = TicketStatus.VALID
        face_id = faces.enroll(event.id, ticket.id, image_bytes("JPEG", (32 + n, 32)))
        db.add(
            BiometricProfile(
                ticket_id=ticket.id, face_id=face_id, collection_id=collection_id, consent_at=datetime.now(UTC)
            )
        )
    db.commit()


def _profiles(db: Session, event: Event) -> int:
    query = select(func.count(BiometricProfile.id)).where(
        BiometricProfile.collection_id == f"bioaccess-event-{event.id}"
    )
    return int(db.scalar(query) or 0)


def test_purges_closed_event(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.ACTIVE, **live_window())
    other = make_event(EventStatus.ACTIVE, **live_window())
    _enroll_tickets(db, faces, make_user, event, 2)
    _enroll_tickets(db, faces, make_user, other, 1)
    event.status = EventStatus.CLOSED
    db.commit()

    result = biometrics.purge_event_biometrics(db, faces, event.id, make_user(UserRole.ADMIN))

    assert (result.event_id, result.deleted_profiles) == (event.id, 2)
    assert _profiles(db, event) == 0
    assert event.face_collection_id is None
    with pytest.raises(CollectionNotFoundError):  # the whole collection is gone
        faces.search(event.id, image_bytes("JPEG", (32, 32)), threshold=95)
    assert (_profiles(db, other), faces.face_count(other.id)) == (1, 1)  # other events untouched


def test_event_that_already_ended_can_be_purged(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.ACTIVE, **live_window())
    _enroll_tickets(db, faces, make_user, event, 1)
    now = datetime.now(UTC)
    event.starts_at, event.ends_at = now - timedelta(hours=5), now - timedelta(hours=1)  # still ACTIVE, but over
    db.commit()

    result = biometrics.purge_event_biometrics(db, faces, event.id, make_user(UserRole.ADMIN))

    assert result.deleted_profiles == 1


@pytest.mark.parametrize("status", [EventStatus.ACTIVE, EventStatus.DRAFT])
def test_open_event_is_refused(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent, status: EventStatus
) -> None:
    event = make_event(EventStatus.ACTIVE, **live_window())
    _enroll_tickets(db, faces, make_user, event, 1)
    event.status = status
    db.commit()

    with pytest.raises(biometrics.EventStillOpenError):
        biometrics.purge_event_biometrics(db, faces, event.id, make_user(UserRole.ADMIN))
    assert (_profiles(db, event), faces.face_count(event.id)) == (1, 1)


def test_second_purge_reports_zero(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.ACTIVE, **live_window())
    _enroll_tickets(db, faces, make_user, event, 1)
    event.status = EventStatus.CLOSED
    db.commit()
    admin = make_user(UserRole.ADMIN)
    biometrics.purge_event_biometrics(db, faces, event.id, admin)

    again = biometrics.purge_event_biometrics(db, faces, event.id, admin)

    assert again.deleted_profiles == 0


def test_provider_failure_keeps_references(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.ACTIVE, **live_window())
    _enroll_tickets(db, faces, make_user, event, 1)
    event.status = EventStatus.CLOSED
    db.commit()
    faces.available = False

    with pytest.raises(FaceProviderError):
        biometrics.purge_event_biometrics(db, faces, event.id, make_user(UserRole.ADMIN))

    assert _profiles(db, event) == 1
    assert event.face_collection_id is not None


def test_unknown_event(db: Session, faces: FakeFaceProvider, make_user: MakeUser) -> None:
    with pytest.raises(EventNotFoundError):
        biometrics.purge_event_biometrics(db, faces, 999_999, make_user(UserRole.ADMIN))
