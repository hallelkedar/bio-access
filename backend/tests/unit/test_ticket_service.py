from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


def test_creates_pending_ticket_with_unguessable_token(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    user = make_user()
    event = make_event(EventStatus.ACTIVE)

    ticket = ticket_service.create_ticket(db, user, event.id)

    assert ticket.status == TicketStatus.PENDING_PAYMENT
    assert ticket.user_id == user.id
    assert ticket.event_id == event.id
    assert len(ticket.qr_token) >= 40


def test_tokens_are_unique(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.ACTIVE)

    first = ticket_service.create_ticket(db, make_user(), event.id)
    second = ticket_service.create_ticket(db, make_user(), event.id)

    assert first.qr_token != second.qr_token


def test_duplicate_ticket_rejected(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    user = make_user()
    event = make_event(EventStatus.ACTIVE)
    ticket_service.create_ticket(db, user, event.id)

    with pytest.raises(ticket_service.TicketAlreadyExistsError):
        ticket_service.create_ticket(db, user, event.id)


def test_sold_out_event_rejected(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.ACTIVE, capacity=1)
    ticket_service.create_ticket(db, make_user(), event.id)

    with pytest.raises(ticket_service.SoldOutError):
        ticket_service.create_ticket(db, make_user(), event.id)


def test_cancelled_tickets_free_their_seat_and_can_be_rebought(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    user = make_user()
    event = make_event(EventStatus.ACTIVE, capacity=1)
    ticket = ticket_service.create_ticket(db, user, event.id)
    old_token = ticket.qr_token
    ticket.status = TicketStatus.CANCELLED
    db.commit()

    again = ticket_service.create_ticket(db, user, event.id)

    assert again.id == ticket.id
    assert again.status == TicketStatus.PENDING_PAYMENT
    assert again.qr_token != old_token


@pytest.mark.parametrize("status", [EventStatus.DRAFT, EventStatus.CLOSED])
def test_non_active_event_not_found(
    db: Session, make_user: MakeUser, make_event: MakeEvent, status: EventStatus
) -> None:
    event = make_event(status)

    with pytest.raises(EventNotFoundError):
        ticket_service.create_ticket(db, make_user(), event.id)


def test_missing_event_not_found(db: Session, make_user: MakeUser) -> None:
    with pytest.raises(EventNotFoundError):
        ticket_service.create_ticket(db, make_user(), 999_999)


def test_ended_event_rejected(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.ACTIVE)

    with pytest.raises(ticket_service.EventEndedError):
        ticket_service.create_ticket(
            db, make_user(), event.id, now=event.ends_at + timedelta(minutes=1)
        )


def test_running_event_still_sells(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    now = datetime.now(UTC)
    event = make_event(
        EventStatus.ACTIVE, starts_at=now - timedelta(hours=1), ends_at=now + timedelta(hours=1)
    )

    assert ticket_service.create_ticket(db, make_user(), event.id).status == TicketStatus.PENDING_PAYMENT


def test_my_tickets_only_own_sorted_by_event_start(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    me, other = make_user(), make_user()
    now = datetime.now(UTC)
    later = make_event(EventStatus.ACTIVE, starts_at=now + timedelta(days=5), ends_at=now + timedelta(days=5, hours=2))
    sooner = make_event(EventStatus.ACTIVE, starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=1, hours=2))
    ticket_service.create_ticket(db, me, later.id)
    ticket_service.create_ticket(db, me, sooner.id)
    ticket_service.create_ticket(db, other, sooner.id)

    mine = ticket_service.list_my_tickets(db, me)

    assert [t.event.id for t in mine] == [sooner.id, later.id]
    assert mine[0].event.name == sooner.name


@pytest.mark.parametrize(
    ("status", "shows_qr"),
    [
        (TicketStatus.PENDING_PAYMENT, False),
        (TicketStatus.VALID, True),
        (TicketStatus.ENTERED, False),
        (TicketStatus.CANCELLED, False),
    ],
)
def test_qr_token_only_for_valid_tickets(
    db: Session, make_user: MakeUser, make_event: MakeEvent, status: TicketStatus, shows_qr: bool
) -> None:
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    ticket.status = status
    db.commit()

    [mine] = ticket_service.list_my_tickets(db, user)

    assert mine.status == status
    assert (mine.qr_token == ticket.qr_token) if shows_qr else (mine.qr_token is None)


def test_qr_for_valid_ticket(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    ticket.status = TicketStatus.VALID
    db.commit()

    png = ticket_service.get_my_ticket_qr(db, user, ticket.id)

    assert png.startswith(b"\x89PNG")


def test_qr_of_other_users_ticket_not_found(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    ticket = ticket_service.create_ticket(db, make_user(), make_event(EventStatus.ACTIVE).id)
    ticket.status = TicketStatus.VALID
    db.commit()

    with pytest.raises(ticket_service.TicketNotFoundError):
        ticket_service.get_my_ticket_qr(db, make_user(), ticket.id)


@pytest.mark.parametrize("status", [TicketStatus.PENDING_PAYMENT, TicketStatus.ENTERED, TicketStatus.CANCELLED])
def test_qr_only_for_valid_tickets(
    db: Session, make_user: MakeUser, make_event: MakeEvent, status: TicketStatus
) -> None:
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    ticket.status = status
    db.commit()

    with pytest.raises(ticket_service.TicketNotValidError):
        ticket_service.get_my_ticket_qr(db, user, ticket.id)


def test_my_tickets_report_enrollment(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    from datetime import UTC, datetime

    from app.models.biometric_profile import BiometricProfile

    user = make_user()
    first = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    second = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    stranger_ticket = ticket_service.create_ticket(db, make_user(), make_event(EventStatus.ACTIVE).id)
    db.add_all(
        [
            BiometricProfile(ticket_id=first.id, face_id="f1", collection_id="c", consent_at=datetime.now(UTC)),
            BiometricProfile(ticket_id=stranger_ticket.id, face_id="f2", collection_id="c", consent_at=datetime.now(UTC)),
        ]
    )
    db.commit()

    enrolled = {ticket.id: ticket.enrolled for ticket in ticket_service.list_my_tickets(db, user)}

    assert enrolled == {first.id: True, second.id: False}
