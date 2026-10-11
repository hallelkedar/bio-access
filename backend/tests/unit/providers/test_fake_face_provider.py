from collections.abc import Iterator

import pytest

from app.core.config import Settings
from app.providers import face as face_providers
from app.providers.face.base import (
    CollectionNotFoundError,
    FaceProviderError,
    NoFaceInImageError,
    QualityIssue,
    QualityResult,
    collection_id_for,
)
from app.providers.face.fake import FakeFaceProvider

ALICE = b"alice-face-image"
BOB = b"bob-face-image"
STRANGER = b"stranger-face-image"


@pytest.fixture
def provider() -> FakeFaceProvider:
    fake = FakeFaceProvider()
    fake.ensure_collection(1)
    return fake


def test_collection_id_naming() -> None:
    assert collection_id_for(42) == "bioaccess-event-42"


def test_ensure_collection_is_idempotent(provider: FakeFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=ALICE)

    assert provider.ensure_collection(1) == "bioaccess-event-1"
    assert provider.face_count(1) == 1  # existing faces kept


def test_enrolled_face_matches_its_ticket(provider: FakeFaceProvider) -> None:
    alice_face = provider.enroll(1, ticket_id=10, image=ALICE)
    provider.enroll(1, ticket_id=11, image=BOB)

    match = provider.search(1, ALICE, threshold=95)

    assert match is not None
    assert match.ticket_id == 10
    assert match.face_id == alice_face
    assert match.similarity >= 95


def test_stranger_does_not_match(provider: FakeFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=ALICE)

    assert provider.search(1, STRANGER, threshold=95) is None


def test_similarity_below_threshold_does_not_match(provider: FakeFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=ALICE)
    provider.set_similarity(ALICE, 90.0)

    assert provider.search(1, ALICE, threshold=95) is None
    assert provider.search(1, ALICE, threshold=85) is not None


def test_collections_are_separate_per_event(provider: FakeFaceProvider) -> None:
    provider.ensure_collection(2)
    provider.enroll(1, ticket_id=10, image=ALICE)

    assert provider.search(2, ALICE, threshold=95) is None


def test_deleted_face_no_longer_matches(provider: FakeFaceProvider) -> None:
    face_id = provider.enroll(1, ticket_id=10, image=ALICE)

    provider.delete_face(1, face_id)
    provider.delete_face(1, face_id)  # already gone: no error

    assert provider.search(1, ALICE, threshold=95) is None


def test_delete_collection_removes_everything(provider: FakeFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=ALICE)

    provider.delete_collection(1)
    provider.delete_collection(1)  # already gone: no error

    assert provider.face_count(1) == 0
    with pytest.raises(CollectionNotFoundError):
        provider.search(1, ALICE, threshold=95)


def test_enroll_without_collection_fails() -> None:
    with pytest.raises(CollectionNotFoundError):
        FakeFaceProvider().enroll(99, ticket_id=1, image=ALICE)


def test_quality_ok_by_default_and_overridable(provider: FakeFaceProvider) -> None:
    provider.set_quality(BOB, QualityResult((QualityIssue.MULTIPLE_FACES, QualityIssue.BLURRY)))

    assert provider.check_quality(ALICE).ok
    bad = provider.check_quality(BOB)
    assert not bad.ok
    assert bad.issues == (QualityIssue.MULTIPLE_FACES, QualityIssue.BLURRY)


def test_unavailable_provider_raises_on_every_call(provider: FakeFaceProvider) -> None:
    provider.available = False

    for call in (
        lambda: provider.ensure_collection(1),
        lambda: provider.check_quality(ALICE),
        lambda: provider.enroll(1, 10, ALICE),
        lambda: provider.search(1, ALICE, 95),
        lambda: provider.delete_face(1, "x"),
        lambda: provider.delete_collection(1),
    ):
        with pytest.raises(FaceProviderError):
            call()


def test_images_are_not_kept(provider: FakeFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=ALICE)

    assert ALICE not in repr(provider.__dict__).encode()


@pytest.fixture
def _clear_cache() -> Iterator[None]:
    face_providers.get_face_provider.cache_clear()
    yield
    face_providers.get_face_provider.cache_clear()


@pytest.mark.usefixtures("_clear_cache")
def test_factory_selects_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(face_provider="fake")  # type: ignore[call-arg]
    monkeypatch.setattr(face_providers, "get_settings", lambda: settings)

    assert isinstance(face_providers.get_face_provider(), FakeFaceProvider)


def test_search_without_face_raises(provider: FakeFaceProvider) -> None:
    provider.set_quality(STRANGER, QualityResult((QualityIssue.NO_FACE,)))

    with pytest.raises(NoFaceInImageError):
        provider.search(1, STRANGER, threshold=95)
