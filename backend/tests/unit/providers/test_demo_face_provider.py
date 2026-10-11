import io
import logging
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from PIL import Image, ImageFilter

from app.core.config import Settings
from app.providers import face as face_providers
from app.providers.face.base import CollectionNotFoundError, QualityIssue
from app.providers.face.demo import DemoFaceProvider
from app.utils.image_validation import InvalidImageError


def _jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _photo(size: tuple[int, int] = (320, 240)) -> bytes:
    """Detailed, normally lit picture (random texture)."""
    return _jpeg(Image.frombytes("L", size, os.urandom(size[0] * size[1])).convert("RGB"))


@pytest.fixture
def provider(tmp_path: Path) -> DemoFaceProvider:
    demo = DemoFaceProvider(tmp_path / "demo_faces.json")
    demo.ensure_collection(1)
    return demo


def test_good_photo_passes(provider: DemoFaceProvider) -> None:
    assert provider.check_quality(_photo()).ok


def test_dark_photo(provider: DemoFaceProvider) -> None:
    dark = Image.frombytes("L", (320, 240), bytes(b // 8 for b in os.urandom(320 * 240))).convert("RGB")

    assert provider.check_quality(_jpeg(dark)).issues == (QualityIssue.TOO_DARK,)


def test_blurry_photo(provider: DemoFaceProvider) -> None:
    sharp = Image.frombytes("L", (320, 240), os.urandom(320 * 240)).convert("RGB")
    blurry = sharp.filter(ImageFilter.GaussianBlur(12)).point(lambda v: 128 + (v - 128) // 4)

    assert QualityIssue.BLURRY in provider.check_quality(_jpeg(blurry)).issues


def test_tiny_photo(provider: DemoFaceProvider) -> None:
    assert QualityIssue.TOO_SMALL in provider.check_quality(_photo((80, 60))).issues


def test_unreadable_image(provider: DemoFaceProvider) -> None:
    with pytest.raises(InvalidImageError):
        provider.check_quality(b"not an image")


def test_search_returns_latest_enrolled_ticket(provider: DemoFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=_photo())
    latest = provider.enroll(1, ticket_id=11, image=_photo())

    match = provider.search(1, _photo(), threshold=95)  # any frame: this is a demo

    assert match is not None
    assert (match.ticket_id, match.face_id, match.similarity) == (11, latest, 99.0)


def test_threshold_above_demo_similarity_means_no_match(provider: DemoFaceProvider) -> None:
    provider.enroll(1, ticket_id=10, image=_photo())

    assert provider.search(1, _photo(), threshold=99.5) is None


def test_events_are_separate_and_unknown_event_has_nobody(provider: DemoFaceProvider) -> None:
    provider.ensure_collection(2)
    provider.enroll(1, ticket_id=10, image=_photo())

    assert provider.search(2, _photo(), threshold=95) is None
    assert provider.search(99, _photo(), threshold=95) is None  # activated before switching to demo


def test_enroll_needs_a_collection(tmp_path: Path) -> None:
    with pytest.raises(CollectionNotFoundError):
        DemoFaceProvider(tmp_path / "f.json").enroll(5, ticket_id=1, image=_photo())


def test_delete_face_and_collection(provider: DemoFaceProvider) -> None:
    first = provider.enroll(1, ticket_id=10, image=_photo())
    provider.enroll(1, ticket_id=11, image=_photo())

    provider.delete_face(1, provider.search(1, b"", 95).face_id)  # type: ignore[union-attr]
    assert provider.search(1, b"", 95).face_id == first  # type: ignore[union-attr]

    provider.delete_collection(1)
    assert provider.search(1, b"", 95) is None


def test_state_survives_a_restart_and_holds_no_image_data(tmp_path: Path) -> None:
    state_file = tmp_path / "demo_faces.json"
    photo = _photo()
    before = DemoFaceProvider(state_file)
    before.ensure_collection(1)
    before.enroll(1, ticket_id=10, image=photo)

    after = DemoFaceProvider(state_file)  # e.g. uvicorn --reload

    assert after.search(1, b"", 95).ticket_id == 10  # type: ignore[union-attr]
    content = state_file.read_bytes()
    assert len(content) < 200  # ids only
    assert photo[:64] not in content


def test_warns_loudly(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        DemoFaceProvider(tmp_path / "f.json")

    assert "NOT real face recognition" in caplog.text


@pytest.fixture
def _clear_cache() -> Iterator[None]:
    face_providers.get_face_provider.cache_clear()
    yield
    face_providers.get_face_provider.cache_clear()


@pytest.mark.usefixtures("_clear_cache")
def test_factory_selects_demo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = Settings(face_provider="demo", demo_faces_file=tmp_path / "f.json")  # type: ignore[call-arg]
    monkeypatch.setattr(face_providers, "get_settings", lambda: settings)

    assert isinstance(face_providers.get_face_provider(), DemoFaceProvider)


def test_flat_image_is_blurry_not_fooled_by_its_border(provider: DemoFaceProvider) -> None:
    flat = _jpeg(Image.new("RGB", (320, 240), (128, 128, 128)))

    assert QualityIssue.BLURRY in provider.check_quality(flat).issues
