import pytest
from sqlalchemy.orm import Session

from app.providers.face.base import NoFaceInImageError, QualityIssue, QualityResult
from app.providers.face.fake import FakeFaceProvider
from app.repositories import setting_repository
from app.services import face_search

ALICE = b"alice"
STRANGER = b"stranger"


@pytest.fixture
def faces() -> FakeFaceProvider:
    fake = FakeFaceProvider()
    fake.ensure_collection(1)
    fake.enroll(1, ticket_id=10, image=ALICE)
    return fake


def test_enrolled_face_identified(db: Session, faces: FakeFaceProvider) -> None:
    match = face_search.identify(db, faces, 1, ALICE)

    assert match is not None and match.ticket_id == 10


def test_stranger_not_identified(db: Session, faces: FakeFaceProvider) -> None:
    assert face_search.identify(db, faces, 1, STRANGER) is None


def test_threshold_from_settings_is_used(db: Session, faces: FakeFaceProvider) -> None:
    faces.set_similarity(ALICE, 90.0)
    setting_repository.set_value(db, "face_match_threshold", "85")
    assert face_search.identify(db, faces, 1, ALICE) is not None

    setting_repository.set_value(db, "face_match_threshold", "95")
    assert face_search.identify(db, faces, 1, ALICE) is None


def test_no_face_in_frame(db: Session, faces: FakeFaceProvider) -> None:
    faces.set_quality(STRANGER, QualityResult((QualityIssue.NO_FACE,)))

    with pytest.raises(NoFaceInImageError):
        face_search.identify(db, faces, 1, STRANGER)
