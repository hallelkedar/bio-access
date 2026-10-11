from sqlalchemy.orm import Session

from app.models.access_log import AccessReason, AccessResult
from app.models.ticket import TicketStatus
from app.providers.face.base import (
    CollectionNotFoundError,
    FaceProvider,
    FaceProviderError,
    NoFaceInImageError,
)
from app.repositories import ticket_repository, user_repository
from app.schemas.gate import GateVerifyResult
from app.services import event as event_service
from app.services import face_search
from app.utils.image_validation import InvalidImageError, validate_image

FACE_IMAGE_FORMATS = ("JPEG", "PNG")


def _denied(
    reason: AccessReason, ticket_id: int | None = None, similarity: float | None = None
) -> GateVerifyResult:
    return GateVerifyResult(
        result=AccessResult.DENIED, reason=reason, ticket_id=ticket_id, similarity=similarity
    )


def verify_face(
    db: Session, face_provider: FaceProvider, event_id: int, image: bytes, max_bytes: int
) -> GateVerifyResult:
    """Decide whether the person in the frame may enter. Read-only: changes nothing.

    Every outcome is a decision (approved, or denied with a reason), never an
    exception, except EventNotFoundError for an unknown event id.
    """
    event_service.get_event(db, event_id)  # raises EventNotFoundError

    try:
        validate_image(image, max_bytes, FACE_IMAGE_FORMATS)
        match = face_search.identify(db, face_provider, event_id, image)
    except (InvalidImageError, NoFaceInImageError):
        return _denied(AccessReason.LOW_QUALITY)
    except CollectionNotFoundError:
        return _denied(AccessReason.EVENT_NOT_ACTIVE)
    except FaceProviderError:
        return _denied(AccessReason.PROVIDER_ERROR)  # the gate offers the QR fallback
    if match is None:
        return _denied(AccessReason.NOT_RECOGNIZED)

    ticket = ticket_repository.get_by_id(db, match.ticket_id)
    if ticket is None or ticket.event_id != event_id:
        return _denied(AccessReason.NOT_RECOGNIZED, similarity=match.similarity)
    if ticket.status == TicketStatus.ENTERED:
        return _denied(AccessReason.ALREADY_ENTERED, ticket_id=ticket.id, similarity=match.similarity)
    if ticket.status != TicketStatus.VALID:
        return _denied(AccessReason.CANCELLED, ticket_id=ticket.id, similarity=match.similarity)

    user = user_repository.get_by_id(db, ticket.user_id)
    return GateVerifyResult(
        result=AccessResult.APPROVED,
        reason=AccessReason.NONE,
        ticket_id=ticket.id,
        user_name=user.full_name if user else None,
        similarity=match.similarity,
    )
