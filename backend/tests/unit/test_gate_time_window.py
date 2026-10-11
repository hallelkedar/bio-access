from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.access_log import AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.providers.face.fake import FakeFaceProvider
from app.services import access_control
from app.services import ticket as ticket_service
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
MB = 1024 * 1024
FACE = image_bytes("JPEG", (32, 32))
START = datetime(2026, 12, 1, 20, 0, tzinfo=UTC)
END = START + timedelta(hours=4)


def _event(status: EventStatus = EventStatus.ACTIVE) -> Event:
    return Event(status=status, starts_at=START, ends_at=END)


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (START - timedelta(minutes=61), False),  # before doors open
        (START - timedelta(minutes=60), True),  # doors open
        (START + timedelta(hours=1), True),  # during the event
        (END - timedelta(seconds=1), True),
        (END, False),  # over
    ],
)
def test_window_with_doors_open_60_minutes_before(now: datetime, expected: bool) -> None:
    assert access_control.event_open_for_entry(_event(), now, early_minutes=60) is expected


def test_strict_window_with_zero_early_minutes() -> None:
    assert not access_control.event_open_for_entry(_event(), START - timedelta(minutes=1), early_minutes=0)
    assert access_control.event_open_for_entry(_event(), START, early_minutes=0)


@pytest.mark.parametrize("status", [EventStatus.DRAFT, EventStatus.CLOSED])
def test_non_active_event_closed(status: EventStatus) -> None:
    assert not access_control.event_open_for_entry(_event(status), START + timedelta(hours=1), early_minutes=60)


def test_default_early_minutes_come_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "gate_opens_minutes_before", 0)

    assert not access_control.event_open_for_entry(_event(), START - timedelta(minutes=30))


@pytest.fixture
def enrolled_event(db: Session, make_user: MakeUser, make_event: MakeEvent) -> tuple[Event, int, FakeFaceProvider]:
    user = make_user()
    event = make_event(EventStatus.ACTIVE, starts_at=START, ends_at=END)
    ticket = ticket_service.create_ticket(db, user, event.id, now=START - timedelta(days=1))
    ticket.status = TicketStatus.VALID
    db.commit()
    faces = FakeFaceProvider()
    faces.ensure_collection(event.id)
    faces.enroll(event.id, ticket.id, FACE)
    return event, ticket.id, faces


@pytest.mark.parametrize("now", [START - timedelta(hours=2), END + timedelta(minutes=1)])
def test_verify_outside_window_denied_without_face_search(
    db: Session, enrolled_event: tuple[Event, int, FakeFaceProvider], now: datetime
) -> None:
    event, _, faces = enrolled_event
    faces.available = False  # a face search would turn into PROVIDER_ERROR

    decision = access_control.verify_face(db, faces, event.id, "north-1", FACE, MB, now=now)

    assert (decision.result, decision.reason) == (AccessResult.DENIED, AccessReason.EVENT_NOT_ACTIVE)


def test_verify_inside_window_approved(db: Session, enrolled_event: tuple[Event, int, FakeFaceProvider]) -> None:
    event, ticket_id, faces = enrolled_event

    decision = access_control.verify_face(db, faces, event.id, "north-1", FACE, MB, now=START - timedelta(minutes=30))

    assert decision.result == AccessResult.APPROVED
    assert decision.ticket_id == ticket_id


def test_qr_entry_outside_window_denied(db: Session, enrolled_event: tuple[Event, int, FakeFaceProvider]) -> None:
    event, ticket_id, _ = enrolled_event

    decision = access_control.attempt_entry(
        db, event.id, ticket_id, "north-1", AccessMethod.QR, now=END + timedelta(minutes=5)
    )

    assert (decision.reason, decision.ticket_id) == (AccessReason.EVENT_NOT_ACTIVE, ticket_id)


def test_entry_denied_after_event_closed(db: Session, enrolled_event: tuple[Event, int, FakeFaceProvider]) -> None:
    event, ticket_id, _ = enrolled_event
    event.status = EventStatus.CLOSED
    db.commit()

    decision = access_control.attempt_entry(
        db, event.id, ticket_id, "north-1", AccessMethod.QR, now=START + timedelta(hours=1)
    )

    assert decision.reason == AccessReason.EVENT_NOT_ACTIVE
