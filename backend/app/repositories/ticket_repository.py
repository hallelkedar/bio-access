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
