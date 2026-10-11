"""Offline: Rekognition is replaced by botocore's Stubber (no AWS calls)."""

from collections.abc import Iterator

import boto3
import pytest
from botocore.stub import Stubber

from app.core.config import Settings
from app.providers import face as face_providers
from app.providers.face.base import (
    CollectionNotFoundError,
    FaceNotIndexedError,
    FaceProviderError,
    NoFaceInImageError,
    QualityIssue,
    QualityResult,
)
from app.providers.face.rekognition import RekognitionFaceProvider
from app.utils.image_validation import InvalidImageError


@pytest.fixture
def stubbed() -> Iterator[tuple[RekognitionFaceProvider, Stubber]]:
    client = boto3.client(
        "rekognition", region_name="eu-west-1", aws_access_key_id="x", aws_secret_access_key="y"
    )
    with Stubber(client) as stubber:
        yield RekognitionFaceProvider("eu-west-1", client=client), stubber
        stubber.assert_no_pending_responses()


def test_ensure_collection_creates_it(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response(
        "create_collection", {"StatusCode": 200}, {"CollectionId": "bioaccess-event-7"}
    )

    assert provider.ensure_collection(7) == "bioaccess-event-7"


def test_ensure_collection_is_idempotent(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("create_collection", service_error_code="ResourceAlreadyExistsException")

    assert provider.ensure_collection(7) == "bioaccess-event-7"


@pytest.mark.parametrize("code", ["AccessDeniedException", "ThrottlingException", "InternalServerError"])
def test_ensure_collection_errors_become_provider_errors(
    stubbed: tuple[RekognitionFaceProvider, Stubber], code: str
) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("create_collection", service_error_code=code)

    with pytest.raises(FaceProviderError, match=code) as exc_info:
        provider.ensure_collection(7)
    assert exc_info.value.__cause__ is None


def test_delete_collection(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response("delete_collection", {"StatusCode": 200}, {"CollectionId": "bioaccess-event-7"})

    provider.delete_collection(7)


def test_delete_missing_collection_is_ok(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("delete_collection", service_error_code="ResourceNotFoundException")

    provider.delete_collection(7)


def test_delete_collection_access_denied(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("delete_collection", service_error_code="AccessDeniedException")

    with pytest.raises(FaceProviderError):
        provider.delete_collection(7)


def test_network_error_becomes_provider_error() -> None:
    from botocore.exceptions import EndpointConnectionError

    class Unreachable:
        def create_collection(self, **_: object) -> None:
            raise EndpointConnectionError(endpoint_url="https://rekognition.eu-west-1.amazonaws.com")

    with pytest.raises(FaceProviderError, match="EndpointConnectionError"):
        RekognitionFaceProvider("eu-west-1", client=Unreachable()).ensure_collection(7)


@pytest.fixture
def _clear_cache() -> Iterator[None]:
    face_providers.get_face_provider.cache_clear()
    yield
    face_providers.get_face_provider.cache_clear()


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    settings = Settings(**overrides)  # type: ignore[arg-type]
    monkeypatch.setattr(face_providers, "get_settings", lambda: settings)


@pytest.mark.usefixtures("_clear_cache")
def test_factory_selects_rekognition(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, face_provider="rekognition", aws_access_key_id="x", aws_secret_access_key="y")

    assert isinstance(face_providers.get_face_provider(), RekognitionFaceProvider)


@pytest.mark.usefixtures("_clear_cache")
def test_factory_rekognition_without_keys_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, face_provider="rekognition", aws_access_key_id=None, aws_secret_access_key=None)

    with pytest.raises(RuntimeError, match="AWS_ACCESS_KEY_ID"):
        face_providers.get_face_provider()


# --- check_quality (DetectFaces) ---------------------------------------------

IMAGE = b"\xff\xd8 fake jpeg bytes"
DETECT_PARAMS = {"Image": {"Bytes": IMAGE}, "Attributes": ["DEFAULT"]}


def _face(
    width: float = 0.4,
    confidence: float = 99.9,
    brightness: float = 80.0,
    sharpness: float = 70.0,
    yaw: float = 0.0,
    pitch: float = 0.0,
) -> dict[str, object]:
    return {
        "BoundingBox": {"Width": width, "Height": width * 1.3, "Left": 0.3, "Top": 0.2},
        "Confidence": confidence,
        "Quality": {"Brightness": brightness, "Sharpness": sharpness},
        "Pose": {"Roll": 0.0, "Yaw": yaw, "Pitch": pitch},
    }


def _quality(stubbed: tuple[RekognitionFaceProvider, Stubber], *faces: dict[str, object]) -> QualityResult:
    provider, stubber = stubbed
    stubber.add_response("detect_faces", {"FaceDetails": list(faces)}, DETECT_PARAMS)
    return provider.check_quality(IMAGE)


def test_good_face_passes(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    result = _quality(stubbed, _face())

    assert result.ok


def test_no_face(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    assert _quality(stubbed).issues == (QualityIssue.NO_FACE,)


def test_two_faces(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    assert _quality(stubbed, _face(), _face(width=0.3)).issues == (QualityIssue.MULTIPLE_FACES,)


def test_tiny_background_face_is_ignored(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    assert _quality(stubbed, _face(), _face(width=0.03)).ok


@pytest.mark.parametrize(
    ("face", "issue"),
    [
        (_face(confidence=80), QualityIssue.LOW_CONFIDENCE),
        (_face(width=0.1), QualityIssue.TOO_SMALL),
        (_face(brightness=20), QualityIssue.TOO_DARK),
        (_face(sharpness=5), QualityIssue.BLURRY),
        (_face(yaw=40), QualityIssue.BAD_POSE),
        (_face(pitch=-35), QualityIssue.BAD_POSE),
    ],
)
def test_each_threshold(
    stubbed: tuple[RekognitionFaceProvider, Stubber], face: dict[str, object], issue: QualityIssue
) -> None:
    assert _quality(stubbed, face).issues == (issue,)


def test_all_issues_reported_together(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    result = _quality(stubbed, _face(brightness=10, sharpness=5, yaw=60))

    assert set(result.issues) == {QualityIssue.TOO_DARK, QualityIssue.BLURRY, QualityIssue.BAD_POSE}


@pytest.mark.parametrize("code", ["InvalidImageFormatException", "ImageTooLargeException"])
def test_rejected_image_raises_invalid_image(
    stubbed: tuple[RekognitionFaceProvider, Stubber], code: str
) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("detect_faces", service_error_code=code)

    with pytest.raises(InvalidImageError):
        provider.check_quality(IMAGE)


def test_detect_faces_access_denied(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("detect_faces", service_error_code="AccessDeniedException")

    with pytest.raises(FaceProviderError, match="AccessDeniedException") as exc_info:
        provider.check_quality(IMAGE)
    assert "fake jpeg" not in str(exc_info.value)


# --- enroll (IndexFaces) -------------------------------------------------------

INDEX_PARAMS = {
    "CollectionId": "bioaccess-event-7",
    "Image": {"Bytes": IMAGE},
    "ExternalImageId": "42",
    "MaxFaces": 1,
    "QualityFilter": "AUTO",
    "DetectionAttributes": [],
}


def test_enroll_returns_face_id(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response(
        "index_faces",
        {"FaceRecords": [{"Face": {"FaceId": "11111111-2222-3333-4444-555555555555", "ExternalImageId": "42"}}]},
        INDEX_PARAMS,
    )

    assert provider.enroll(7, 42, IMAGE) == "11111111-2222-3333-4444-555555555555"


def test_enroll_unindexed_face_maps_reasons(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response(
        "index_faces",
        {"FaceRecords": [], "UnindexedFaces": [{"Reasons": ["LOW_SHARPNESS", "EXTREME_POSE", "LOW_SHARPNESS"]}]},
        INDEX_PARAMS,
    )

    with pytest.raises(FaceNotIndexedError) as exc_info:
        provider.enroll(7, 42, IMAGE)
    assert exc_info.value.issues == (QualityIssue.BLURRY, QualityIssue.BAD_POSE)


def test_enroll_no_face_at_all(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response("index_faces", {"FaceRecords": [], "UnindexedFaces": []}, INDEX_PARAMS)

    with pytest.raises(FaceNotIndexedError) as exc_info:
        provider.enroll(7, 42, IMAGE)
    assert exc_info.value.issues == (QualityIssue.NO_FACE,)


@pytest.mark.parametrize(
    ("code", "error"),
    [
        ("ResourceNotFoundException", CollectionNotFoundError),
        ("InvalidImageFormatException", InvalidImageError),
        ("ProvisionedThroughputExceededException", FaceProviderError),
    ],
)
def test_enroll_errors(
    stubbed: tuple[RekognitionFaceProvider, Stubber], code: str, error: type[Exception]
) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("index_faces", service_error_code=code)

    with pytest.raises(error):
        provider.enroll(7, 42, IMAGE)


# --- search (SearchFacesByImage) ----------------------------------------------

SEARCH_PARAMS = {
    "CollectionId": "bioaccess-event-7",
    "Image": {"Bytes": IMAGE},
    "FaceMatchThreshold": 95.0,
    "MaxFaces": 1,
}


def _match(external_id: str, similarity: float, face_id: str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -> dict[str, object]:
    return {"Similarity": similarity, "Face": {"FaceId": face_id, "ExternalImageId": external_id}}


def test_search_returns_match(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response("search_faces_by_image", {"FaceMatches": [_match("42", 99.1)]}, SEARCH_PARAMS)

    match = provider.search(7, IMAGE, 95.0)

    assert match is not None
    assert (match.ticket_id, match.similarity) == (42, 99.1)
    assert match.face_id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def test_search_no_match(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response("search_faces_by_image", {"FaceMatches": []}, SEARCH_PARAMS)

    assert provider.search(7, IMAGE, 95.0) is None


def test_search_skips_foreign_faces(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_response(
        "search_faces_by_image", {"FaceMatches": [_match("added-by-hand", 99.9), _match("42", 97.0)]}, SEARCH_PARAMS
    )

    match = provider.search(7, IMAGE, 95.0)

    assert match is not None and match.ticket_id == 42


def test_search_no_face_in_image(stubbed: tuple[RekognitionFaceProvider, Stubber]) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("search_faces_by_image", service_error_code="InvalidParameterException")

    with pytest.raises(NoFaceInImageError):
        provider.search(7, IMAGE, 95.0)


@pytest.mark.parametrize(
    ("code", "error"),
    [
        ("ResourceNotFoundException", CollectionNotFoundError),
        ("ImageTooLargeException", InvalidImageError),
        ("ThrottlingException", FaceProviderError),
    ],
)
def test_search_errors(stubbed: tuple[RekognitionFaceProvider, Stubber], code: str, error: type[Exception]) -> None:
    provider, stubber = stubbed
    stubber.add_client_error("search_faces_by_image", service_error_code=code)

    with pytest.raises(error):
        provider.search(7, IMAGE, 95.0)
