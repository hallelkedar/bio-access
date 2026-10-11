from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from app.models.access_log import AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.face.base import QualityIssue, QualityResult
from app.providers.face.fake import FakeFaceProvider
from app.services import access_control
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
MB = 1024 * 1024
FACE = image_bytes("JPEG", (32, 32))
STRANGER = image_bytes("PNG", (32, 32))


@pytest.fixture
def faces() -> FakeFaceProvider:
    return FakeFaceProvider()


@pytest.fixture
def enrolled(
    db: Session, make_user: MakeUser, make_event: MakeEvent, faces: FakeFaceProvider
) -> tuple[Event, Ticket, User]:
    """An ACTIVE event with one VALID ticket whose holder enrolled FACE."""
    user = make_user()
    event = make_event(EventStatus.ACTIVE)
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

    decision = access_control.verify_face(db, faces, event.id, FACE, MB)

    assert decision.result == AccessResult.APPROVED
    assert decision.reason == AccessReason.NONE
    assert decision.ticket_id == ticket.id
    assert decision.user_name == user.full_name
    assert decision.similarity is not None and decision.similarity >= 95
    db.refresh(ticket)
    assert ticket.status == TicketStatus.VALID  # read-only in 7.1


def test_stranger_not_recognized(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled

    decision = access_control.verify_face(db, faces, event.id, STRANGER, MB)

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

    decision = access_control.verify_face(db, faces, event.id, FACE, MB)

    assert (decision.result, decision.reason, decision.ticket_id) == (AccessResult.DENIED, reason, ticket.id)


def test_no_face_in_frame_is_low_quality(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled
    faces.set_quality(STRANGER, QualityResult((QualityIssue.NO_FACE,)))

    assert access_control.verify_face(db, faces, event.id, STRANGER, MB).reason == AccessReason.LOW_QUALITY


def test_invalid_image_is_low_quality(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]
) -> None:
    event, _, _ = enrolled

    assert access_control.verify_face(db, faces, event.id, b"garbage", MB).reason == AccessReason.LOW_QUALITY


def test_missing_collection_is_event_not_active(db: Session, faces: FakeFaceProvider, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.DRAFT)

    assert access_control.verify_face(db, faces, event.id, FACE, MB).reason == AccessReason.EVENT_NOT_ACTIVE


def test_provider_outage(db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User]) -> None:
    event, _, _ = enrolled
    faces.available = False

    assert access_control.verify_face(db, faces, event.id, FACE, MB).reason == AccessReason.PROVIDER_ERROR


def test_match_from_other_event_not_recognized(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[Event, Ticket, User], make_event: MakeEvent
) -> None:
    _, ticket, _ = enrolled
    other = make_event(EventStatus.ACTIVE)
    faces.ensure_collection(other.id)
    faces.enroll(other.id, ticket.id, FACE)  # corrupted collection: face tagged with a foreign ticket

    assert access_control.verify_face(db, faces, other.id, FACE, MB).reason == AccessReason.NOT_RECOGNIZED


def test_unknown_event(db: Session, faces: FakeFaceProvider) -> None:
    with pytest.raises(EventNotFoundError):
        access_control.verify_face(db, faces, 999_999, FACE, MB)
