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
