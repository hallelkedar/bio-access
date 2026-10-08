from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus


def get_by_id(db: Session, event_id: int) -> Event | None:
    return db.get(Event, event_id)




def get_by_id_for_update(db: Session, event_id: int) -> Event | None:
    """Load the event and lock its row until the transaction ends (SELECT ... FOR UPDATE)."""
    return db.scalars(select(Event).where(Event.id == event_id).with_for_update()).first()


def list_active(db: Session, now: datetime) -> list[Event]:
    """ACTIVE events that have not ended yet, soonest first."""
    query = (
        select(Event)
        .where(Event.status == EventStatus.ACTIVE, Event.ends_at > now)
        .order_by(Event.starts_at, Event.id)
    )
    return list(db.scalars(query))


def create(db: Session, event: Event) -> Event:
    db.add(event)
    db.flush()
    return event


def delete(db: Session, event: Event) -> None:
    db.delete(event)
    db.flush()
