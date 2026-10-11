from collections.abc import Callable

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.face.base import QualityIssue, QualityResult
from app.providers.face.fake import FakeFaceProvider
from app.services import access_control
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError
from tests.events import live_window
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
MB = 1024 * 1024
FACE = image_bytes("JPEG", (32, 32))
STRANGER = image_bytes("PNG", (32, 32))
GATE = "north-1"


def _logs(db: Session, event_id: int) -> list[AccessLog]:
    return list(db.scalars(select(AccessLog).where(AccessLog.event_id == event_id).order_by(AccessLog.id)))


@pytest.fixture
def faces() -> FakeFaceProvider:
    return FakeFaceProvider()


@pytest.fixture
def enrolled(
    db: Session, make_user: MakeUser, make_event: MakeEvent, faces: FakeFaceProvider
) -> tuple[Event, Ticket, User]:
    """An ACTIVE event with one VALID ticket whose holder enrolled FACE."""
    user = make_user()
    event = make_event(EventStatus.ACTIVE, **live_window())
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()
    faces.ensure_collection(event.id)
    faces.enroll(event.id, ticket.id, FACE)
    return event, ticket, user



def test_valid_enrolled_ticket_is_approved(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, ticket, user = enrolled

    decision = access_control.verify_face(db, faces, event.id, GATE, FACE, MB)

    assert decision.result == AccessResult.APPROVED
    assert decision.reason == AccessReason.NONE
    assert decision.ticket_id == ticket.id
    assert decision.user_name == user.full_name
    assert decision.similarity is not None and decision.similarity >= 95
    db.refresh(ticket)
    assert ticket.status == TicketStatus.ENTERED
    assert ticket.entered_at is not None
    [log] = _logs(db, event.id)
    assert (log.result, log.reason, log.ticket_id) == (AccessResult.APPROVED, AccessReason.NONE, ticket.id)
    assert (log.gate_id, log.method) == (GATE, AccessMethod.FACE)
    assert log.similarity == decision.similarity


def test_stranger_not_recognized(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled

    decision = access_control.verify_face(db, faces, event.id, GATE, STRANGER, MB)

    assert (decision.result, decision.reason) == (AccessResult.DENIED, AccessReason.NOT_RECOGNIZED)
    assert decision.user_name is None


@pytest.mark.parametrize(
    ("status", "reason"),
    [(TicketStatus.ENTERED, AccessReason.ALREADY_ENTERED), (TicketStatus.CANCELLED, AccessReason.CANCELLED)],
)
def test_ticket_status_denials(
    db: Session,
    faces: FakeFaceProvider,
    enrolled: tuple[Event, Ticket, User],
    status: TicketStatus,
    reason: AccessReason,
) -> None:
    event, ticket, _ = enrolled
    ticket.status = status
    db.commit()

    decision = access_control.verify_face(db, faces, event.id, GATE, FACE, MB)

    assert (decision.result, decision.reason, decision.ticket_id) == (AccessResult.DENIED, reason, ticket.id)


def test_no_face_in_frame_is_low_quality(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled
    faces.set_quality(STRANGER, QualityResult((QualityIssue.NO_FACE,)))

    assert access_control.verify_face(db, faces, event.id, GATE, STRANGER, MB).reason == AccessReason.LOW_QUALITY


def test_invalid_image_is_low_quality(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled

    assert access_control.verify_face(db, faces, event.id, GATE, b"garbage", MB).reason == AccessReason.LOW_QUALITY


def test_missing_collection_is_event_not_active(db: Session, faces: FakeFaceProvider, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.DRAFT)

    assert access_control.verify_face(db, faces, event.id, GATE, FACE, MB).reason == AccessReason.EVENT_NOT_ACTIVE


def test_provider_outage(db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]) -> None:
    event, _, _ = enrolled
    faces.available = False

    assert access_control.verify_face(db, faces, event.id, GATE, FACE, MB).reason == AccessReason.PROVIDER_ERROR


def test_match_from_other_event_not_recognized(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User], make_event: MakeEvent
) -> None:
    _, ticket, _ = enrolled
    other = make_event(EventStatus.ACTIVE, **live_window())
    faces.ensure_collection(other.id)
    faces.enroll(other.id, ticket.id, FACE)  # corrupted collection: face tagged with a foreign ticket

    assert access_control.verify_face(db, faces, other.id, GATE, FACE, MB).reason == AccessReason.NOT_RECOGNIZED


def test_unknown_event(db: Session, faces: FakeFaceProvider) -> None:
    with pytest.raises(EventNotFoundError):
        access_control.verify_face(db, faces, 999_999, GATE, FACE, MB)


def test_second_scan_is_already_entered(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, ticket, _ = enrolled
    access_control.verify_face(db, faces, event.id, GATE, FACE, MB)

    second = access_control.verify_face(db, faces, event.id, "south-2", FACE, MB)

    assert (second.result, second.reason, second.ticket_id) == (
        AccessResult.DENIED,
        AccessReason.ALREADY_ENTERED,
        ticket.id,
    )
    logs = _logs(db, event.id)
    assert [log.result for log in logs] == [AccessResult.APPROVED, AccessResult.DENIED]
    assert logs[1].gate_id == "south-2"


def test_denials_are_logged_without_ticket(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled

    access_control.verify_face(db, faces, event.id, GATE, STRANGER, MB)

    [log] = _logs(db, event.id)
    assert (log.result, log.reason, log.ticket_id) == (AccessResult.DENIED, AccessReason.NOT_RECOGNIZED, None)


def test_failed_approval_log_rolls_back_entry(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    event, ticket, _ = enrolled

    def broken_create(*_: object) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr("app.repositories.access_log_repository.create", broken_create)

    with pytest.raises(RuntimeError):
        access_control.verify_face(db, faces, event.id, GATE, FACE, MB)
    db.refresh(ticket)
    assert ticket.status == TicketStatus.VALID
    assert ticket.entered_at is None


def test_failed_denial_log_still_returns_decision(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    event, _, _ = enrolled

    def broken_create(*_: object) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr("app.repositories.access_log_repository.create", broken_create)

    decision = access_control.verify_face(db, faces, event.id, GATE, STRANGER, MB)

    assert decision.reason == AccessReason.NOT_RECOGNIZED


def test_attempt_entry_with_qr_method(db: Session, enrolled: tuple[Event, Ticket, User]) -> None:
    event, ticket, user = enrolled

    decision = access_control.attempt_entry(db, event.id, ticket.id, "vip-gate", AccessMethod.QR)

    assert decision.result == AccessResult.APPROVED
    assert decision.user_name == user.full_name
    assert decision.similarity is None
    [log] = _logs(db, event.id)
    assert (log.method, log.similarity) == (AccessMethod.QR, None)


def test_attempt_entry_wrong_event(
    db: Session, enrolled: tuple[Event, Ticket, User], make_event: MakeEvent
) -> None:
    _, ticket, _ = enrolled
    other = make_event(EventStatus.ACTIVE, **live_window())

    decision = access_control.attempt_entry(db, other.id, ticket.id, GATE, AccessMethod.QR)

    assert decision.reason == AccessReason.NOT_RECOGNIZED
    db.refresh(ticket)
    assert ticket.status == TicketStatus.VALID
