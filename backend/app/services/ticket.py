import secrets
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.event import EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.repositories import event_repository, ticket_repository
from app.schemas.ticket import EventSummary, MyTicketRead
from app.services.event import EventNotFoundError


class EventEndedError(Exception):
    pass


class TicketAlreadyExistsError(Exception):
    pass


class SoldOutError(Exception):
    pass


def generate_qr_token() -> str:
    return secrets.token_urlsafe(32)


def create_ticket(db: Session, user: User, event_id: int, now: datetime | None = None) -> Ticket:
    """Reserve a seat as a PENDING_PAYMENT ticket.

    The event row is locked (SELECT ... FOR UPDATE) so concurrent buyers are
    serialized and capacity can never be exceeded.
    """
    now = now or datetime.now(UTC)
    try:
        event = event_repository.get_by_id_for_update(db, event_id)
        if event is None or event.status != EventStatus.ACTIVE:
            raise EventNotFoundError(event_id)
        if event.ends_at <= now:
            raise EventEndedError(event_id)

        existing = ticket_repository.get_by_event_and_user(db, event_id, user.id)
        if existing is not None and existing.status != TicketStatus.CANCELLED:
            raise TicketAlreadyExistsError(event_id)

        if ticket_repository.count_reserved(db, event_id) >= event.capacity:
            raise SoldOutError(event_id)

        if existing is not None:
            # UNIQUE(event_id, user_id): reuse the cancelled ticket with a fresh token.
            ticket = existing
            ticket.status = TicketStatus.PENDING_PAYMENT
            ticket.qr_token = generate_qr_token()
            ticket.purchased_at = now
            ticket.entered_at = None
        else:
            ticket = ticket_repository.create(
                db,
                Ticket(
                    event_id=event_id,
                    user_id=user.id,
                    qr_token=generate_qr_token(),
                    status=TicketStatus.PENDING_PAYMENT,
                ),
            )
        db.commit()
    except Exception:
        db.rollback()  # releases the row lock immediately
        raise
    return ticket


def list_my_tickets(db: Session, user: User) -> list[MyTicketRead]:
    """The QR token is only revealed for VALID (paid, not yet used) tickets."""
    return [
        MyTicketRead(
            id=ticket.id,
            event_id=ticket.event_id,
            status=ticket.status,
            purchased_at=ticket.purchased_at,
            entered_at=ticket.entered_at,
            event=EventSummary.model_validate(ticket.event),
            qr_token=ticket.qr_token if ticket.status == TicketStatus.VALID else None,
        )
        for ticket in ticket_repository.list_by_user(db, user.id)
    ]
