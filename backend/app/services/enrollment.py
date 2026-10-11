import logging
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
from app.models.event import EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.providers.face.base import FaceNotIndexedError, FaceProvider, QualityIssue
from app.repositories import biometric_repository, ticket_repository
from app.schemas.enrollment import EnrollmentRead
from app.utils.image_validation import validate_image

logger = logging.getLogger(__name__)

# Rekognition accepts only these (no WebP).
FACE_IMAGE_FORMATS = ("JPEG", "PNG")


class ConsentRequiredError(Exception):
    pass


class TicketNotFoundError(Exception):
    pass


class TicketNotValidError(Exception):
    pass


class EventNotOpenError(Exception):
    pass


class AlreadyEnrolledError(Exception):
    pass


class LowQualityError(Exception):
    def __init__(self, issues: tuple[QualityIssue, ...]) -> None:
        super().__init__(", ".join(issue.value for issue in issues))
        self.issues = issues


def enroll_face(
    db: Session,
    face_provider: FaceProvider,
    user: User,
    ticket_id: int,
    image: bytes,
    consent: bool,
    max_bytes: int,
    now: datetime | None = None,
) -> EnrollmentRead:
    """Bind the user's face to their paid ticket.

    The image lives only in memory for the duration of this call: it is sent to
    the face provider and never written to disk, the database or the logs.
    Only the provider's face_id is stored.
    """
    now = now or datetime.now(UTC)
    if not consent:
        raise ConsentRequiredError()

    ticket = ticket_repository.get_by_id(db, ticket_id)
    if ticket is None or ticket.user_id != user.id:
        raise TicketNotFoundError(ticket_id)
    if ticket.status != TicketStatus.VALID:
        raise TicketNotValidError(ticket_id)
    event = ticket.event
    if event.status != EventStatus.ACTIVE or event.ends_at <= now:
        raise EventNotOpenError(event.id)
    if biometric_repository.get_by_ticket_id(db, ticket_id) is not None:
        raise AlreadyEnrolledError(ticket_id)

    validate_image(image, max_bytes, FACE_IMAGE_FORMATS)
    quality = face_provider.check_quality(image)
    if not quality.ok:
        raise LowQualityError(quality.issues)

    collection_id = face_provider.ensure_collection(event.id)
    try:
        face_id = face_provider.enroll(event.id, ticket_id, image)
    except FaceNotIndexedError as exc:
        raise LowQualityError(exc.issues) from None

    try:
        biometric_repository.create(
            db,
            BiometricProfile(
                ticket_id=ticket_id, face_id=face_id, collection_id=collection_id, consent_at=now
            ),
        )
        if event.face_collection_id is None:
            event.face_collection_id = collection_id
        db.commit()
    except IntegrityError:
        # A parallel request enrolled this ticket first: undo our copy in the collection.
        db.rollback()
        _remove_orphan_face(face_provider, event.id, face_id)
        raise AlreadyEnrolledError(ticket_id) from None
    except Exception:
        db.rollback()
        _remove_orphan_face(face_provider, event.id, face_id)
        raise
    return EnrollmentRead(ticket_id=ticket_id, enrolled_at=now)


def _remove_orphan_face(face_provider: FaceProvider, event_id: int, face_id: str) -> None:
    try:
        face_provider.delete_face(event_id, face_id)
    except Exception:
        # Purging the event's collection (6.8) removes it anyway.
        logger.warning("could not remove orphan face %s from event %s", face_id, event_id)
