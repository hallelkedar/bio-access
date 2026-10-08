from sqlalchemy import func, select
from sqlalchemy.orm import Session

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


def create(db: Session, ticket: Ticket) -> Ticket:
    db.add(ticket)
    db.flush()
    return ticket
