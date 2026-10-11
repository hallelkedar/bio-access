from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.providers.face.base import FaceMatch, FaceProvider, FaceProviderError, QualityResult, collection_id_for


def _error_code(exc: ClientError) -> str:
    return str(exc.response.get("Error", {}).get("Code", ""))


class RekognitionFaceProvider(FaceProvider):
    """AWS Rekognition: one collection per event; faces tagged with ExternalImageId = ticket_id."""

    def __init__(
        self,
        region: str,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        client: Any | None = None,
    ) -> None:
        self._client = client or boto3.client(
            "rekognition",
            region_name=region,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    def ensure_collection(self, event_id: int) -> str:
        collection_id = collection_id_for(event_id)
        try:
            self._client.create_collection(CollectionId=collection_id)
        except ClientError as exc:
            if _error_code(exc) != "ResourceAlreadyExistsException":
                raise FaceProviderError(f"create_collection failed: {_error_code(exc)}") from None
        except BotoCoreError as exc:
            raise FaceProviderError(f"create_collection failed: {type(exc).__name__}") from None
        return collection_id

    def delete_collection(self, event_id: int) -> None:
        try:
            self._client.delete_collection(CollectionId=collection_id_for(event_id))
        except ClientError as exc:
            if _error_code(exc) != "ResourceNotFoundException":
                raise FaceProviderError(f"delete_collection failed: {_error_code(exc)}") from None
        except BotoCoreError as exc:
            raise FaceProviderError(f"delete_collection failed: {type(exc).__name__}") from None

    # Implemented in later BUILD_PLAN steps.
    def check_quality(self, image: bytes) -> QualityResult:  # 6.4
        raise NotImplementedError

    def enroll(self, event_id: int, ticket_id: int, image: bytes) -> str:  # 6.5
        raise NotImplementedError

    def search(self, event_id: int, image: bytes, threshold: float) -> FaceMatch | None:  # 6.6
        raise NotImplementedError

    def delete_face(self, event_id: int, face_id: str) -> None:  # 6.8
        raise NotImplementedError
