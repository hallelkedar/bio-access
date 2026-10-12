from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.user import User
from app.providers.face.base import FaceProvider
from app.repositories import event_repository, ticket_repository
from app.schemas.event import LOCATION_FORMAT_ERROR, EventCreate, EventUpdate, is_venue_city


class EventNotFoundError(Exception):
    pass


class InvalidEventError(Exception):
    pass


class EventNotDeletableError(Exception):
    pass


def create_event(db: Session, data: EventCreate, admin: User) -> Event:
    event = event_repository.create(db, Event(**data.model_dump(), created_by=admin.id))
    db.commit()
    return event


def get_event(db: Session, event_id: int) -> Event:
    event = event_repository.get_by_id(db, event_id)
    if event is None:
        raise EventNotFoundError(event_id)
    return event


def get_visible_event(db: Session, event_id: int, user: User) -> Event:
    """Admins see every event; everyone else only sees ACTIVE ones."""
    event = get_event(db, event_id)
    if event.status != EventStatus.ACTIVE and not user.is_admin:
        raise EventNotFoundError(event_id)
    return event



def list_all_events(db: Session) -> list[Event]:
    """Admins manage drafts and closed events too, not just the public catalog."""
    return event_repository.list_all(db)


def list_catalog(db: Session, now: datetime | None = None) -> list[Event]:
    return event_repository.list_active(db, now or datetime.now(UTC))


def update_event(
    db: Session, event_id: int, data: EventUpdate, face_provider: FaceProvider
) -> Event:
    """Apply a partial update. Activating an event creates its face collection first.

    Raises FaceProviderError (nothing is saved) if the collection can't be created,
    so an event never goes ACTIVE without somewhere to enroll faces.
    """
    event = get_event(db, event_id)
    changes = data.model_dump(exclude_unset=True)

    # Check the time window on the merged values: only one side may have been sent.
    starts_at = changes.get("starts_at", event.starts_at)
    ends_at = changes.get("ends_at", event.ends_at)
    if ends_at <= starts_at:
        raise InvalidEventError("ends_at must be after starts_at")
    new_location = changes.get("location")
    if new_location is not None and new_location != event.location and not is_venue_city(new_location):
        raise InvalidEventError(LOCATION_FORMAT_ERROR)

    try:
        if changes.get("status") == EventStatus.ACTIVE and event.status != EventStatus.ACTIVE:
            event.face_collection_id = face_provider.ensure_collection(event.id)
        for field, value in changes.items():
            setattr(event, field, value)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return event


def delete_event(db: Session, event_id: int) -> None:
    """Only empty drafts can be deleted; events with tickets should be CLOSED instead."""
    event = get_event(db, event_id)
    if event.status != EventStatus.DRAFT:
        raise EventNotDeletableError("only DRAFT events can be deleted")
    if ticket_repository.count_by_event(db, event.id) > 0:
        raise EventNotDeletableError("event has tickets")
    event_repository.delete(db, event)
    db.commit()
