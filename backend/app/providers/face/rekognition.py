from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.providers.face.base import (
    FaceMatch,
    FaceProvider,
    FaceProviderError,
    QualityIssue,
    QualityResult,
    collection_id_for,
)
from app.utils.image_validation import InvalidImageError

# Starting values for the enrollment quality gate; tune them with real tests.
MIN_CONFIDENCE = 90.0  # % that the detection is a face
MIN_BRIGHTNESS = 40.0  # Rekognition Quality.Brightness, 0-100
MIN_SHARPNESS = 20.0  # Rekognition Quality.Sharpness, 0-100
MAX_POSE_DEGREES = 25.0  # |yaw| and |pitch|
MIN_FACE_WIDTH = 0.20  # face box width as a fraction of the image width
BACKGROUND_FACE_WIDTH = 0.05  # smaller faces are ignored when counting faces

# Rekognition rejects these images; they are the caller's fault, not an outage.
_BAD_IMAGE_ERRORS = {"InvalidImageFormatException", "ImageTooLargeException", "InvalidParameterException"}


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

    def check_quality(self, image: bytes) -> QualityResult:
        """DetectFaces, then report every problem at once so the UI can show them together."""
        try:
            response = self._client.detect_faces(Image={"Bytes": image}, Attributes=["DEFAULT"])
        except ClientError as exc:
            if _error_code(exc) in _BAD_IMAGE_ERRORS:
                raise InvalidImageError("image must be a JPEG or PNG up to 5 MB") from None
            raise FaceProviderError(f"detect_faces failed: {_error_code(exc)}") from None
        except BotoCoreError as exc:
            raise FaceProviderError(f"detect_faces failed: {type(exc).__name__}") from None

        faces = [
            face
            for face in response.get("FaceDetails", [])
            if face["BoundingBox"]["Width"] >= BACKGROUND_FACE_WIDTH
        ]
        if not faces:
            return QualityResult((QualityIssue.NO_FACE,))
        if len(faces) > 1:
            return QualityResult((QualityIssue.MULTIPLE_FACES,))

        face = faces[0]
        issues: list[QualityIssue] = []
        if face["Confidence"] < MIN_CONFIDENCE:
            issues.append(QualityIssue.LOW_CONFIDENCE)
        if face["BoundingBox"]["Width"] < MIN_FACE_WIDTH:
            issues.append(QualityIssue.TOO_SMALL)
        if face["Quality"]["Brightness"] < MIN_BRIGHTNESS:
            issues.append(QualityIssue.TOO_DARK)
        if face["Quality"]["Sharpness"] < MIN_SHARPNESS:
            issues.append(QualityIssue.BLURRY)
        pose = face["Pose"]
        if abs(pose["Yaw"]) > MAX_POSE_DEGREES or abs(pose["Pitch"]) > MAX_POSE_DEGREES:
            issues.append(QualityIssue.BAD_POSE)
        return QualityResult(tuple(issues))

    # Implemented in later BUILD_PLAN steps.

    def enroll(self, event_id: int, ticket_id: int, image: bytes) -> str:  # 6.5
        raise NotImplementedError

    def search(self, event_id: int, image: bytes, threshold: float) -> FaceMatch | None:  # 6.6
        raise NotImplementedError

    def delete_face(self, event_id: int, face_id: str) -> None:  # 6.8
        raise NotImplementedError
