from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.face.base import FaceProviderError, QualityIssue, QualityResult
from app.providers.face.fake import FakeFaceProvider
from app.services import enrollment as enrollment_service
from app.services import ticket as ticket_service
from app.utils.image_validation import ImageTooLargeError, InvalidImageError
from tests.images import image_bytes

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
MB = 1024 * 1024
PHOTO = image_bytes("JPEG", (64, 64))


@pytest.fixture
def faces() -> FakeFaceProvider:
    return FakeFaceProvider()


@pytest.fixture
def valid_ticket(db: Session, make_user: MakeUser, make_event: MakeEvent) -> tuple[User, Ticket]:
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    ticket.status = TicketStatus.VALID
    db.commit()
    return user, ticket


def _enroll(
    db: Session, faces: FakeFaceProvider, user: User, ticket_id: int, image: bytes = PHOTO, consent: bool = True
) -> object:
    return enrollment_service.enroll_face(db, faces, user, ticket_id, image, consent, MB)


def _profile(db: Session, ticket_id: int) -> BiometricProfile | None:
    return db.scalars(select(BiometricProfile).where(BiometricProfile.ticket_id == ticket_id)).first()


def test_enrolls_face_and_stores_only_reference(
    db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]
) -> None:
    user, ticket = valid_ticket

    result = _enroll(db, faces, user, ticket.id)

    profile = _profile(db, ticket.id)
    assert profile is not None
    assert profile.collection_id == f"bioaccess-event-{ticket.event_id}"
    assert profile.consent_at is not None
    assert result.ticket_id == ticket.id  # type: ignore[attr-defined]
    match = faces.search(ticket.event_id, PHOTO, threshold=95)
    assert match is not None and match.ticket_id == ticket.id and match.face_id == profile.face_id


def test_consent_required(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket

    with pytest.raises(enrollment_service.ConsentRequiredError):
        _enroll(db, faces, user, ticket.id, consent=False)
    assert faces.face_count(ticket.event_id) == 0


def test_other_users_ticket_not_found(
    db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket], make_user: MakeUser
) -> None:
    _, ticket = valid_ticket

    with pytest.raises(enrollment_service.TicketNotFoundError):
        _enroll(db, faces, make_user(), ticket.id)


@pytest.mark.parametrize("status", [TicketStatus.PENDING_PAYMENT, TicketStatus.ENTERED, TicketStatus.CANCELLED])
def test_only_valid_tickets(
    db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket], status: TicketStatus
) -> None:
    user, ticket = valid_ticket
    ticket.status = status
    db.commit()

    with pytest.raises(enrollment_service.TicketNotValidError):
        _enroll(db, faces, user, ticket.id)


def test_closed_event_rejected(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket
    ticket.event.status = EventStatus.CLOSED
    db.commit()

    with pytest.raises(enrollment_service.EventNotOpenError):
        _enroll(db, faces, user, ticket.id)


def test_ended_event_rejected(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket
    later = ticket.event.ends_at + timedelta(minutes=1)

    with pytest.raises(enrollment_service.EventNotOpenError):
        enrollment_service.enroll_face(db, faces, user, ticket.id, PHOTO, True, MB, now=later)


def test_second_enrollment_rejected(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket
    _enroll(db, faces, user, ticket.id)

    with pytest.raises(enrollment_service.AlreadyEnrolledError):
        _enroll(db, faces, user, ticket.id)
    assert faces.face_count(ticket.event_id) == 1


def test_webp_rejected(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket

    with pytest.raises(InvalidImageError):
        _enroll(db, faces, user, ticket.id, image=image_bytes("WEBP"))


def test_too_large_rejected(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket

    with pytest.raises(ImageTooLargeError):
        enrollment_service.enroll_face(db, faces, user, ticket.id, PHOTO, True, max_bytes=10)


def test_low_quality_reports_issues(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket
    faces.set_quality(PHOTO, QualityResult((QualityIssue.TOO_DARK, QualityIssue.BAD_POSE)))

    with pytest.raises(enrollment_service.LowQualityError) as exc_info:
        _enroll(db, faces, user, ticket.id)
    assert exc_info.value.issues == (QualityIssue.TOO_DARK, QualityIssue.BAD_POSE)
    assert _profile(db, ticket.id) is None


def test_provider_outage_saves_nothing(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket
    faces.available = False

    with pytest.raises(FaceProviderError):
        _enroll(db, faces, user, ticket.id)
    assert _profile(db, ticket.id) is None


def test_db_failure_removes_orphan_face(
    db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket], monkeypatch: pytest.MonkeyPatch
) -> None:
    user, ticket = valid_ticket

    def broken_create(*_: object) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr("app.repositories.biometric_repository.create", broken_create)

    with pytest.raises(RuntimeError):
        _enroll(db, faces, user, ticket.id)
    assert faces.face_count(ticket.event_id) == 0


def test_uses_given_time_for_consent(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket
    now = datetime.now(UTC).replace(microsecond=0)

    enrollment_service.enroll_face(db, faces, user, ticket.id, PHOTO, True, MB, now=now)

    profile = _profile(db, ticket.id)
    assert profile is not None and profile.consent_at == now


# --- replacing the face photo ---------------------------------------------------------------

NEW_PHOTO = image_bytes("JPEG", (80, 80))


def _replace(
    db: Session, faces: FakeFaceProvider, user: User, ticket_id: int, image: bytes = NEW_PHOTO, consent: bool = True
) -> object:
    return enrollment_service.replace_face(db, faces, user, ticket_id, image, consent, MB)


@pytest.fixture
def enrolled(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> tuple[User, Ticket, str]:
    user, ticket = valid_ticket
    _enroll(db, faces, user, ticket.id)
    profile = _profile(db, ticket.id)
    assert profile is not None
    return user, ticket, profile.face_id


def test_replace_swaps_the_face_and_deletes_the_old_one(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[User, Ticket, str]
) -> None:
    user, ticket, old_face = enrolled
    later = datetime.now(UTC) + timedelta(minutes=5)

    result = enrollment_service.replace_face(db, faces, user, ticket.id, NEW_PHOTO, True, MB, now=later)

    profile = _profile(db, ticket.id)
    assert profile is not None and profile.face_id != old_face
    assert profile.consent_at == later  # consent given again for the new photo
    assert result.ticket_id == ticket.id  # type: ignore[attr-defined]
    assert faces.search(ticket.event_id, NEW_PHOTO, threshold=95).face_id == profile.face_id  # type: ignore[union-attr]
    assert faces.search(ticket.event_id, PHOTO, threshold=95) is None  # the old face is gone
    assert faces.face_count(ticket.event_id) == 1


def test_a_bad_new_photo_keeps_the_old_face(db: Session, faces: FakeFaceProvider, enrolled: tuple[User, Ticket, str]) -> None:
    user, ticket, old_face = enrolled
    faces.set_quality(NEW_PHOTO, QualityResult((QualityIssue.NO_FACE,)))

    with pytest.raises(enrollment_service.LowQualityError):
        _replace(db, faces, user, ticket.id)

    assert _profile(db, ticket.id).face_id == old_face  # type: ignore[union-attr]
    assert faces.search(ticket.event_id, PHOTO, threshold=95) is not None


def test_provider_outage_keeps_the_old_face(db: Session, faces: FakeFaceProvider, enrolled: tuple[User, Ticket, str]) -> None:
    user, ticket, old_face = enrolled
    faces.available = False

    with pytest.raises(FaceProviderError):
        _replace(db, faces, user, ticket.id)

    assert _profile(db, ticket.id).face_id == old_face  # type: ignore[union-attr]


def test_db_failure_keeps_the_old_face_and_removes_the_new_copy(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[User, Ticket, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    user, ticket, old_face = enrolled

    def broken_lock(*_: object) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr("app.repositories.biometric_repository.get_by_ticket_id_for_update", broken_lock)

    with pytest.raises(RuntimeError):
        _replace(db, faces, user, ticket.id)

    assert _profile(db, ticket.id).face_id == old_face  # type: ignore[union-attr]
    assert faces.face_count(ticket.event_id) == 1
    assert faces.search(ticket.event_id, PHOTO, threshold=95) is not None


def test_failing_to_delete_the_old_face_still_succeeds(
    db: Session, faces: FakeFaceProvider, enrolled: tuple[User, Ticket, str], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    user, ticket, old_face = enrolled
    real_delete = faces.delete_face

    def flaky_delete(event_id: int, face_id: str) -> None:
        if face_id == old_face:
            raise FaceProviderError("timeout")
        real_delete(event_id, face_id)

    monkeypatch.setattr(faces, "delete_face", flaky_delete)

    _replace(db, faces, user, ticket.id)

    assert _profile(db, ticket.id).face_id != old_face  # type: ignore[union-attr]
    assert "could not remove orphan face" in caplog.text


def test_replace_needs_an_enrolled_ticket(db: Session, faces: FakeFaceProvider, valid_ticket: tuple[User, Ticket]) -> None:
    user, ticket = valid_ticket

    with pytest.raises(enrollment_service.NotEnrolledError):
        _replace(db, faces, user, ticket.id)
    assert faces.face_count(ticket.event_id) == 0


def test_replace_checks_owner_consent_and_ticket(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, enrolled: tuple[User, Ticket, str]
) -> None:
    user, ticket, _ = enrolled

    with pytest.raises(enrollment_service.TicketNotFoundError):
        _replace(db, faces, make_user(), ticket.id)
    with pytest.raises(enrollment_service.ConsentRequiredError):
        _replace(db, faces, user, ticket.id, consent=False)
    ticket.status = TicketStatus.ENTERED
    db.commit()
    with pytest.raises(enrollment_service.TicketNotValidError):
        _replace(db, faces, user, ticket.id)


def test_replace_refused_once_the_event_ended(db: Session, faces: FakeFaceProvider, enrolled: tuple[User, Ticket, str]) -> None:
    user, ticket, _ = enrolled

    with pytest.raises(enrollment_service.EventNotOpenError):
        enrollment_service.replace_face(db, faces, user, ticket.id, NEW_PHOTO, True, MB, now=datetime.now(UTC) + timedelta(days=30))
