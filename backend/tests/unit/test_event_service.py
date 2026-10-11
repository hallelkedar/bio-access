from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import Ticket
from app.models.user import User, UserRole
from app.providers.face.base import FaceProviderError
from app.providers.face.fake import FakeFaceProvider
from app.schemas.event import EventCreate, EventUpdate
from app.services import event as event_service

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]

STARTS = datetime(2027, 1, 1, 20, 0, tzinfo=UTC)


def event_data(**overrides: object) -> EventCreate:
    fields: dict[str, object] = {
        "name": "Concert",
        "location": "Tel Aviv",
        "starts_at": STARTS,
        "ends_at": STARTS + timedelta(hours=3),
        "capacity": 50,
        "price_cents": 1000,
        **overrides,
    }
    return EventCreate(**fields)


def test_create_event_is_draft_and_owned_by_admin(db: Session, make_user: MakeUser) -> None:
    admin = make_user(UserRole.ADMIN)

    event = event_service.create_event(db, event_data(), admin)

    assert event.id is not None
    assert event.status == EventStatus.DRAFT
    assert event.created_by == admin.id
    assert event.currency == "ILS"


def test_create_schema_rejects_end_before_start() -> None:
    with pytest.raises(ValueError):
        event_data(ends_at=STARTS - timedelta(hours=1))


def test_create_schema_rejects_naive_datetime() -> None:
    with pytest.raises(ValueError):
        event_data(starts_at=datetime(2027, 1, 1, 20, 0))


def test_get_event_missing_raises(db: Session) -> None:
    with pytest.raises(event_service.EventNotFoundError):
        event_service.get_event(db, 999_999)


def test_draft_event_hidden_from_regular_user(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.DRAFT)

    with pytest.raises(event_service.EventNotFoundError):
        event_service.get_visible_event(db, event.id, make_user(UserRole.USER))
    assert event_service.get_visible_event(db, event.id, make_user(UserRole.ADMIN)).id == event.id


def test_active_event_visible_to_regular_user(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.ACTIVE)

    assert event_service.get_visible_event(db, event.id, make_user(UserRole.USER)).id == event.id


def test_update_changes_only_sent_fields(db: Session, make_event: MakeEvent) -> None:
    event = make_event(name="Old name", capacity=100)

    updated = event_service.update_event(db, event.id, EventUpdate(name="New name"), FakeFaceProvider())

    assert updated.name == "New name"
    assert updated.capacity == 100


def test_update_can_activate_event(db: Session, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.DRAFT)

    faces = FakeFaceProvider()

    updated = event_service.update_event(db, event.id, EventUpdate(status=EventStatus.ACTIVE), faces)

    assert updated.status == EventStatus.ACTIVE
    assert updated.face_collection_id == f"bioaccess-event-{event.id}"
    assert faces.face_count(event.id) == 0  # collection exists (empty)


def test_update_without_activation_does_not_touch_faces(db: Session, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.DRAFT)
    faces = FakeFaceProvider()
    faces.available = False  # would raise if called

    updated = event_service.update_event(db, event.id, EventUpdate(name="Renamed"), faces)

    assert updated.face_collection_id is None


def test_activation_fails_cleanly_when_face_provider_down(db: Session, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.DRAFT, name="Draft")
    faces = FakeFaceProvider()
    faces.available = False

    with pytest.raises(FaceProviderError):
        event_service.update_event(db, event.id, EventUpdate(status=EventStatus.ACTIVE, name="Live"), faces)

    db.refresh(event)
    assert event.status == EventStatus.DRAFT
    assert event.name == "Draft"
    assert event.face_collection_id is None


def test_update_rejects_end_before_existing_start(db: Session, make_event: MakeEvent) -> None:
    event = make_event()

    with pytest.raises(event_service.InvalidEventError):
        event_service.update_event(
            db, event.id, EventUpdate(ends_at=event.starts_at - timedelta(minutes=1)), FakeFaceProvider()
        )


def test_delete_draft_without_tickets(db: Session, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.DRAFT)

    event_service.delete_event(db, event.id)

    with pytest.raises(event_service.EventNotFoundError):
        event_service.get_event(db, event.id)


def test_delete_active_event_rejected(db: Session, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.ACTIVE)

    with pytest.raises(event_service.EventNotDeletableError):
        event_service.delete_event(db, event.id)


def test_delete_event_with_tickets_rejected(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.DRAFT)
    db.add(Ticket(event_id=event.id, user_id=make_user().id, qr_token="tok-1"))
    db.commit()

    with pytest.raises(event_service.EventNotDeletableError):
        event_service.delete_event(db, event.id)


def test_catalog_lists_only_active_not_ended_events_soonest_first(
    db: Session, make_event: MakeEvent
) -> None:
    now = datetime(2027, 6, 1, 12, 0, tzinfo=UTC)
    later = make_event(EventStatus.ACTIVE, starts_at=now + timedelta(days=2), ends_at=now + timedelta(days=2, hours=3))
    sooner = make_event(EventStatus.ACTIVE, starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=1, hours=3))
    running = make_event(EventStatus.ACTIVE, starts_at=now - timedelta(hours=1), ends_at=now + timedelta(hours=2))
    make_event(EventStatus.ACTIVE, starts_at=now - timedelta(days=1), ends_at=now - timedelta(hours=20))  # ended
    make_event(EventStatus.DRAFT, starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=1, hours=3))
    make_event(EventStatus.CLOSED, starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=1, hours=3))

    catalog = event_service.list_catalog(db, now=now)

    assert [event.id for event in catalog] == [running.id, sooner.id, later.id]
