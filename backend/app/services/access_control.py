import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.providers.face.base import (
    CollectionNotFoundError,
    FaceProvider,
    FaceProviderError,
    NoFaceInImageError,
)
from app.repositories import access_log_repository, event_repository, ticket_repository, user_repository
from app.schemas.gate import GateVerifyResult
from app.services import event as event_service
from app.services import face_search
from app.utils.image_validation import InvalidImageError, validate_image

logger = logging.getLogger(__name__)

FACE_IMAGE_FORMATS = ("JPEG", "PNG")


def event_open_for_entry(event: Event, now: datetime, early_minutes: int | None = None) -> bool:
    """ACTIVE and inside [starts_at - early_minutes, ends_at). Doors open before the show starts."""
    if early_minutes is None:
        early_minutes = get_settings().gate_opens_minutes_before
    opens_at = event.starts_at - timedelta(minutes=early_minutes)
    return event.status == EventStatus.ACTIVE and opens_at <= now < event.ends_at


def _denied(
    reason: AccessReason, ticket_id: int | None = None, similarity: float | None = None
) -> GateVerifyResult:
    return GateVerifyResult(
        result=AccessResult.DENIED, reason=reason, ticket_id=ticket_id, similarity=similarity
    )


def verify_face(
    db: Session,
    face_provider: FaceProvider,
    event_id: int,
    gate_id: str,
    image: bytes,
    max_bytes: int,
    now: datetime | None = None,
) -> GateVerifyResult:
    """Identify the person in the frame and, if their ticket is VALID, let them in.

    Phase 1 (no locks): validate the frame and search the face. The network call
    happens here so no row is locked while waiting for the provider.
    Phase 2: attempt_entry() re-checks and updates the ticket atomically.
    Every attempt is logged. Raises EventNotFoundError for an unknown event id.
    """
    now = now or datetime.now(UTC)
    event = event_service.get_event(db, event_id)  # raises EventNotFoundError
    if not event_open_for_entry(event, now):
        # Checked before the face search: no provider call (cost, latency) for a closed event.
        return _log_denial(db, event_id, gate_id, AccessMethod.FACE, _denied(AccessReason.EVENT_NOT_ACTIVE), now)

    try:
        validate_image(image, max_bytes, FACE_IMAGE_FORMATS)
        match = face_search.identify(db, face_provider, event_id, image)
    except (InvalidImageError, NoFaceInImageError):
        return _log_denial(db, event_id, gate_id, AccessMethod.FACE, _denied(AccessReason.LOW_QUALITY), now)
    except CollectionNotFoundError:
        return _log_denial(db, event_id, gate_id, AccessMethod.FACE, _denied(AccessReason.EVENT_NOT_ACTIVE), now)
    except FaceProviderError:  # the gate offers the QR fallback
        return _log_denial(db, event_id, gate_id, AccessMethod.FACE, _denied(AccessReason.PROVIDER_ERROR), now)
    if match is None:
        return _log_denial(db, event_id, gate_id, AccessMethod.FACE, _denied(AccessReason.NOT_RECOGNIZED), now)

    return attempt_entry(db, event_id, match.ticket_id, gate_id, AccessMethod.FACE, match.similarity, now)


def attempt_entry(
    db: Session,
    event_id: int,
    ticket_id: int,
    gate_id: str,
    method: AccessMethod,
    similarity: float | None = None,
    now: datetime | None = None,
) -> GateVerifyResult:
    """Anti-passback core: let a ticket in at most once, atomically.

    One transaction: lock the ticket row (SELECT ... FOR UPDATE), re-check its
    status under the lock, mark it ENTERED and write the access log together.
    Concurrent attempts for the same ticket wait on the lock, then see ENTERED.
    The event's status and time window are checked here too, so QR entry obeys them.
    Any error rolls everything back. Shared by face (7.2) and QR (7.5) entry.
    """
    now = now or datetime.now(UTC)
    try:
        ticket = ticket_repository.get_by_id_for_update(db, ticket_id)
        event = event_repository.get_by_id(db, event_id)
        if ticket is None or ticket.event_id != event_id:
            decision = _denied(AccessReason.NOT_RECOGNIZED, similarity=similarity)
        elif event is None or not event_open_for_entry(event, now):
            decision = _denied(AccessReason.EVENT_NOT_ACTIVE, ticket_id=ticket.id, similarity=similarity)
        elif ticket.status == TicketStatus.ENTERED:
            decision = _denied(AccessReason.ALREADY_ENTERED, ticket_id=ticket.id, similarity=similarity)
        elif ticket.status != TicketStatus.VALID:
            decision = _denied(AccessReason.CANCELLED, ticket_id=ticket.id, similarity=similarity)
        else:
            ticket.status = TicketStatus.ENTERED
            ticket.entered_at = now
            user = user_repository.get_by_id(db, ticket.user_id)
            decision = GateVerifyResult(
                result=AccessResult.APPROVED,
                reason=AccessReason.NONE,
                ticket_id=ticket.id,
                user_name=user.full_name if user else None,
                similarity=similarity,
            )
        access_log_repository.create(db, _log_row(event_id, gate_id, method, decision, now))
        db.commit()  # also releases the row lock
    except Exception:
        db.rollback()
        raise
    return decision


def _log_row(
    event_id: int, gate_id: str, method: AccessMethod, decision: GateVerifyResult, now: datetime
) -> AccessLog:
    return AccessLog(
        ticket_id=decision.ticket_id,
        event_id=event_id,
        gate_id=gate_id,
        timestamp=now,
        result=decision.result,
        reason=decision.reason,
        similarity=decision.similarity,
        method=method,
    )


def _log_denial(
    db: Session, event_id: int, gate_id: str, method: AccessMethod, decision: GateVerifyResult, now: datetime
) -> GateVerifyResult:
    """Best effort: a failed log write must not hide the denial from the gate."""
    try:
        access_log_repository.create(db, _log_row(event_id, gate_id, method, decision, now))
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("could not write access log for event %s (%s)", event_id, decision.reason.value)
    return decision
