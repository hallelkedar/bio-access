from sqlalchemy import func, select
from sqlalchemy.orm import Session, contains_eager

from app.models.event import Event
from app.models.ticket import Ticket, TicketStatus


def count_by_event(db: Session, event_id: int) -> int:
    return db.scalar(select(func.count()).select_from(Ticket).where(Ticket.event_id == event_id)) or 0


def count_reserved(db: Session, event_id: int) -> int:
    """Tickets holding a seat: everything except CANCELLED."""
    query = (
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.event_id == event_id, Ticket.status != TicketStatus.CANCELLED)
    )
    return db.scalar(query) or 0


def get_by_event_and_user(db: Session, event_id: int, user_id: int) -> Ticket | None:
    query = select(Ticket).where(Ticket.event_id == event_id, Ticket.user_id == user_id)
    return db.scalars(query).first()


def get_by_id(db: Session, ticket_id: int) -> Ticket | None:
    return db.get(Ticket, ticket_id)


def get_by_qr_token(db: Session, qr_token: str) -> Ticket | None:
    return db.scalars(select(Ticket).where(Ticket.qr_token == qr_token)).first()


def get_by_id_for_update(db: Session, ticket_id: int) -> Ticket | None:
    """Load the ticket and lock its row until the transaction ends (SELECT ... FOR UPDATE)."""
    # populate_existing: refresh an object already in the session with the locked row's values.
    # Without it, a ticket loaded earlier (e.g. by QR token) keeps a stale status.
    query = select(Ticket).where(Ticket.id == ticket_id).with_for_update()
    return db.scalars(query.execution_options(populate_existing=True)).first()


def list_by_user(db: Session, user_id: int) -> list[Ticket]:
    """User's tickets with their event loaded in the same query, by event start."""
    query = (
        select(Ticket)
        .join(Ticket.event)
        .options(contains_eager(Ticket.event))
        .where(Ticket.user_id == user_id)
        .order_by(Event.starts_at, Ticket.id)
    )
    return list(db.scalars(query))


def create(db: Session, ticket: Ticket) -> Ticket:
    db.add(ticket)
    db.flush()
    return ticket


def count_by_status(db: Session, event_id: int) -> dict[TicketStatus, int]:
    query = (
        select(Ticket.status, func.count())
        .where(Ticket.event_id == event_id)
        .group_by(Ticket.status)
    )
    return {status: count for status, count in db.execute(query).all()}
