"""Offline: Rekognition is replaced by botocore's Stubber (no AWS calls)."""

from collections.abc import Iterator

import boto3
import pytest
from botocore.stub import Stubber

from app.core.config import Settings
from app.providers import face as face_providers
from app.providers.face.base import FaceProviderError
from app.providers.face.rekognition import RekognitionFaceProvider


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
