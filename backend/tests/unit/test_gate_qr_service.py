from collections.abc import Callable

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.face.fake import FakeFaceProvider
from app.repositories import ticket_repository
from app.services import access_control
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError
from tests.events import live_window
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
FACE = image_bytes("JPEG", (32, 32))
GATE = "north-1"


@pytest.fixture
def paid(db: Session, make_user: MakeUser, make_event: MakeEvent) -> tuple[Event, Ticket, User]:
    user = make_user()
    event = make_event(EventStatus.ACTIVE, **live_window())
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()
    return event, ticket, user


def _logs(db: Session, event_id: int) -> list[AccessLog]:
    return list(db.scalars(select(AccessLog).where(AccessLog.event_id == event_id).order_by(AccessLog.id)))


def test_valid_qr_admits_and_logs_qr_method(db: Session, paid: tuple[Event, Ticket, User]) -> None:
    event, ticket, user = paid

    decision = access_control.verify_qr(db, event.id, GATE, ticket.qr_token)

    assert (decision.result, decision.ticket_id, decision.user_name) == (AccessResult.APPROVED, ticket.id, user.full_name)
    assert decision.similarity is None
    db.refresh(ticket)
    assert ticket.status == TicketStatus.ENTERED
    [log] = _logs(db, event.id)
    assert (log.method, log.result, log.similarity) == (AccessMethod.QR, AccessResult.APPROVED, None)


def test_second_qr_scan_already_entered(db: Session, paid: tuple[Event, Ticket, User]) -> None:
    event, ticket, _ = paid
    access_control.verify_qr(db, event.id, GATE, ticket.qr_token)

    assert access_control.verify_qr(db, event.id, GATE, ticket.qr_token).reason == AccessReason.ALREADY_ENTERED


def test_face_then_qr_shares_anti_passback(db: Session, paid: tuple[Event, Ticket, User]) -> None:
    event, ticket, _ = paid
    faces = FakeFaceProvider()
    faces.ensure_collection(event.id)
    faces.enroll(event.id, ticket.id, FACE)
    assert access_control.verify_face(db, faces, event.id, GATE, FACE, 1024 * 1024).result == AccessResult.APPROVED

    decision = access_control.verify_qr(db, event.id, "south-2", ticket.qr_token)

    assert decision.reason == AccessReason.ALREADY_ENTERED


def test_unknown_token_not_recognized(db: Session, paid: tuple[Event, Ticket, User]) -> None:
    event, _, _ = paid

    decision = access_control.verify_qr(db, event.id, GATE, "made-up-token")

    assert (decision.reason, decision.ticket_id) == (AccessReason.NOT_RECOGNIZED, None)
    [log] = _logs(db, event.id)
    assert (log.method, log.ticket_id) == (AccessMethod.QR, None)


def test_token_from_other_event_not_recognized(
    db: Session, paid: tuple[Event, Ticket, User], make_event: MakeEvent
) -> None:
    _, ticket, _ = paid
    other = make_event(EventStatus.ACTIVE, **live_window())

    assert access_control.verify_qr(db, other.id, GATE, ticket.qr_token).reason == AccessReason.NOT_RECOGNIZED
    db.refresh(ticket)
    assert ticket.status == TicketStatus.VALID


def test_cancelled_ticket(db: Session, paid: tuple[Event, Ticket, User]) -> None:
    event, ticket, _ = paid
    ticket.status = TicketStatus.CANCELLED
    db.commit()

    assert access_control.verify_qr(db, event.id, GATE, ticket.qr_token).reason == AccessReason.CANCELLED


def test_outside_window(db: Session, paid: tuple[Event, Ticket, User]) -> None:
    event, ticket, _ = paid
    event.status = EventStatus.CLOSED
    db.commit()

    assert access_control.verify_qr(db, event.id, GATE, ticket.qr_token).reason == AccessReason.EVENT_NOT_ACTIVE


def test_unknown_event(db: Session) -> None:
    with pytest.raises(EventNotFoundError):
        access_control.verify_qr(db, 999_999, GATE, "token")


def test_locked_read_sees_fresh_status_not_stale_session_copy(
    db: Session, paid: tuple[Event, Ticket, User]
) -> None:
    """Regression: verify_qr loads the ticket before locking it. If another gate commits
    ENTERED in between, the locked read must refresh the in-session object, not trust it."""
    event, ticket, _ = paid
    loaded = ticket_repository.get_by_qr_token(db, ticket.qr_token)
    assert loaded is not None and loaded.status == TicketStatus.VALID
    # Another gate's committed write, bypassing this session's in-memory objects.
    db.execute(text("UPDATE tickets SET status = 'ENTERED' WHERE id = :id"), {"id": ticket.id})

    decision = access_control.attempt_entry(db, event.id, ticket.id, GATE, AccessMethod.QR)

    assert decision.reason == AccessReason.ALREADY_ENTERED
