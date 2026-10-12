import io
import logging
import os
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image, ImageFilter

from app.core.config import Settings
from app.providers import face as face_providers
from app.providers.face.base import CollectionNotFoundError, QualityIssue
from app.providers.face.demo import DemoFaceProvider, count_faces
from app.utils.image_validation import InvalidImageError


def _jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _photo(size: tuple[int, int] = (320, 240)) -> bytes:
    """Detailed, normally lit picture (random texture)."""
    return _jpeg(Image.frombytes("L", size, os.urandom(size[0] * size[1])).convert("RGB"))


def one_face(_picture: object) -> int:
    """The test pictures are random texture, not faces: pretend the detector saw one."""
    return 1


@pytest.fixture
def provider(tmp_path: Path) -> DemoFaceProvider:
    demo = DemoFaceProvider(tmp_path / "demo_faces.json", face_counter=one_face)
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
        DemoFaceProvider(tmp_path / "f.json", face_counter=one_face).enroll(5, ticket_id=1, image=_photo())


def test_delete_face_and_collection(provider: DemoFaceProvider) -> None:
    first = provider.enroll(1, ticket_id=10, image=_photo())
    provider.enroll(1, ticket_id=11, image=_photo())

    provider.delete_face(1, provider.search(1, _photo(), 95).face_id)  # type: ignore[union-attr]
    assert provider.search(1, _photo(), 95).face_id == first  # type: ignore[union-attr]

    provider.delete_collection(1)
    assert provider.search(1, _photo(), 95) is None


def test_state_survives_a_restart_and_holds_no_image_data(tmp_path: Path) -> None:
    state_file = tmp_path / "demo_faces.json"
    photo = _photo()
    before = DemoFaceProvider(state_file, face_counter=one_face)
    before.ensure_collection(1)
    before.enroll(1, ticket_id=10, image=photo)

    after = DemoFaceProvider(state_file, face_counter=one_face)  # e.g. uvicorn --reload

    assert after.search(1, _photo(), 95).ticket_id == 10  # type: ignore[union-attr]
    content = state_file.read_bytes()
    assert len(content) < 200  # ids only
    assert photo[:64] not in content


def test_warns_loudly(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        DemoFaceProvider(tmp_path / "f.json", face_counter=one_face)

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


# --- face counting (OpenCV) --------------------------------------------------------------


@pytest.mark.parametrize(
    "picture",
    [Image.new("L", (640, 480), 128), Image.new("L", (640, 480), 0), Image.frombytes("L", (640, 480), os.urandom(640 * 480))],
    ids=["flat", "black", "noise"],
)
def test_real_detector_finds_no_face_where_there_is_none(picture: Image.Image) -> None:
    assert count_faces(picture) == 0


def test_real_detector_rejects_a_photo_without_a_face(tmp_path: Path) -> None:
    demo = DemoFaceProvider(tmp_path / "f.json")  # the real OpenCV counter

    assert demo.check_quality(_photo()).issues == (QualityIssue.NO_FACE,)


@pytest.mark.parametrize(("faces", "issues"), [(0, (QualityIssue.NO_FACE,)), (1, ()), (2, (QualityIssue.MULTIPLE_FACES,))])
def test_quality_needs_exactly_one_face(tmp_path: Path, faces: int, issues: tuple[QualityIssue, ...]) -> None:
    demo = DemoFaceProvider(tmp_path / "f.json", face_counter=lambda _picture: faces)

    assert demo.check_quality(_photo()).issues == issues


def test_faces_are_not_counted_in_a_dark_or_blurry_frame(tmp_path: Path) -> None:
    counter = MagicMock(return_value=0)
    demo = DemoFaceProvider(tmp_path / "f.json", face_counter=counter)
    dark = Image.frombytes("L", (320, 240), bytes(b // 8 for b in os.urandom(320 * 240))).convert("RGB")

    assert demo.check_quality(_jpeg(dark)).issues == (QualityIssue.TOO_DARK,)  # one clear tip, not two
    counter.assert_not_called()


def test_gate_frame_without_a_face_is_not_recognized(tmp_path: Path) -> None:
    faces = {"count": 1}
    demo = DemoFaceProvider(tmp_path / "f.json", face_counter=lambda _picture: faces["count"])
    demo.ensure_collection(1)
    demo.enroll(1, ticket_id=10, image=_photo())

    faces["count"] = 0  # empty room
    assert demo.search(1, _photo(), 95) is None
    assert demo.search(1, b"not an image", 95) is None
    faces["count"] = 1
    assert demo.search(1, _photo(), 95).ticket_id == 10  # type: ignore[union-attr]


def test_face_check_can_be_switched_off(tmp_path: Path) -> None:
    counter = MagicMock(return_value=0)
    demo = DemoFaceProvider(tmp_path / "f.json", face_check=False, face_counter=counter)
    demo.ensure_collection(1)
    demo.enroll(1, ticket_id=10, image=_photo())

    assert demo.check_quality(_photo()).ok
    assert demo.search(1, b"", 95).ticket_id == 10  # type: ignore[union-attr]  # old behaviour: any frame
    counter.assert_not_called()


@pytest.mark.usefixtures("_clear_cache")
@pytest.mark.parametrize("check", [True, False])
def test_factory_passes_the_face_check_setting(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, check: bool) -> None:
    settings = Settings(face_provider="demo", demo_faces_file=tmp_path / "f.json", demo_face_check=check)  # type: ignore[call-arg]
    monkeypatch.setattr(face_providers, "get_settings", lambda: settings)

    assert face_providers.get_face_provider()._face_check is check  # type: ignore[attr-defined]
