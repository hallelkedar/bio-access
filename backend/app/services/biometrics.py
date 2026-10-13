import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.event import EventStatus
from app.models.user import User
from app.providers.face.base import FaceProvider
from app.repositories import biometric_repository
from app.schemas.admin import BiometricPurgeRead
from app.services import event as event_service

logger = logging.getLogger(__name__)


class EventStillOpenError(Exception):
    """Faces are needed at the gate until the event is CLOSED or over."""


def purge_event_biometrics(
    db: Session, face_provider: FaceProvider, event_id: int, admin: User, now: datetime | None = None
) -> BiometricPurgeRead:
    """Delete every face of the event: the provider's collection, then our face references.

    Only for CLOSED or finished events. The provider goes first: if it fails
    (FaceProviderError), the database is untouched and the admin can retry.
    Repeating it is safe; a second run reports 0.
    Raises EventNotFoundError for an unknown event id.
    """
    now = now or datetime.now(UTC)
    event = event_service.get_event(db, event_id)
    if event.status != EventStatus.CLOSED and event.ends_at > now:
        raise EventStillOpenError(event_id)

    face_provider.delete_collection(event.id)
    try:
        deleted = biometric_repository.delete_for_event(db, event.id)
        event.face_collection_id = None
        db.commit()
    except Exception:
        db.rollback()
        raise
    logger.info("admin %s purged biometrics of event %s: %d face(s)", admin.id, event.id, deleted)
    return BiometricPurgeRead(event_id=event.id, deleted_profiles=deleted)
