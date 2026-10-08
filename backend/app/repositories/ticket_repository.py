from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ticket import Ticket


def count_by_event(db: Session, event_id: int) -> int:
    return db.scalar(select(func.count()).select_from(Ticket).where(Ticket.event_id == event_id)) or 0
