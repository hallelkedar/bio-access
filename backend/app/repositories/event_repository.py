from sqlalchemy.orm import Session

from app.models.event import Event


def get_by_id(db: Session, event_id: int) -> Event | None:
    return db.get(Event, event_id)


def create(db: Session, event: Event) -> Event:
    db.add(event)
    db.flush()
    return event


def delete(db: Session, event: Event) -> None:
    db.delete(event)
    db.flush()
