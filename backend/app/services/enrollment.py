import logging
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
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


class NotEnrolledError(Exception):
    """Replacing needs an existing face: enroll first."""


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
    event = _check_ticket(db, user, ticket_id, consent, now)
    if biometric_repository.get_by_ticket_id(db, ticket_id) is not None:
        raise AlreadyEnrolledError(ticket_id)
    _check_photo(face_provider, image, max_bytes)

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


def replace_face(
    db: Session,
    face_provider: FaceProvider,
    user: User,
    ticket_id: int,
    image: bytes,
    consent: bool,
    max_bytes: int,
    now: datetime | None = None,
) -> EnrollmentRead:
    """Swap the face bound to an already enrolled ticket for a new photo.

    The old face keeps working until the new one is saved: the new face is indexed first,
    then the stored reference is switched (row locked), and only then is the old face
    deleted from the provider. Any failure before the switch removes the new copy and
    leaves the old one in place. Same privacy rules as enroll_face.
    """
    now = now or datetime.now(UTC)
    event = _check_ticket(db, user, ticket_id, consent, now)
    if biometric_repository.get_by_ticket_id(db, ticket_id) is None:
        raise NotEnrolledError(ticket_id)
    _check_photo(face_provider, image, max_bytes)

    collection_id = face_provider.ensure_collection(event.id)
    try:
        new_face_id = face_provider.enroll(event.id, ticket_id, image)
    except FaceNotIndexedError as exc:
        raise LowQualityError(exc.issues) from None

    try:
        profile = biometric_repository.get_by_ticket_id_for_update(db, ticket_id)
        if profile is None:  # deleted in the meantime (e.g. the event's data was purged)
            raise NotEnrolledError(ticket_id)
        old_face_id = profile.face_id
        profile.face_id = new_face_id
        profile.collection_id = collection_id
        profile.consent_at = now
        db.commit()
    except Exception:
        db.rollback()
        _remove_orphan_face(face_provider, event.id, new_face_id)
        raise
    # The new face is live. The old one must go, but if the provider hiccups now the user
    # still has working face entry: log it, like any other orphan.
    _remove_orphan_face(face_provider, event.id, old_face_id)
    return EnrollmentRead(ticket_id=ticket_id, enrolled_at=now)


def _check_ticket(db: Session, user: User, ticket_id: int, consent: bool, now: datetime) -> Event:
    """Consent given, the user's own VALID ticket, and an event still open. Returns the event."""
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
    return event


def _check_photo(face_provider: FaceProvider, image: bytes, max_bytes: int) -> None:
    validate_image(image, max_bytes, FACE_IMAGE_FORMATS)
    quality = face_provider.check_quality(image)
    if not quality.ok:
        raise LowQualityError(quality.issues)


def _remove_orphan_face(face_provider: FaceProvider, event_id: int, face_id: str) -> None:
    try:
        face_provider.delete_face(event_id, face_id)
    except Exception:
        # Purging the event's collection (6.8) removes it anyway.
        logger.warning("could not remove orphan face %s from event %s", face_id, event_id)
