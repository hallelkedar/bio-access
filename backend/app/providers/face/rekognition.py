from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.providers.face.base import (
    CollectionNotFoundError,
    FaceMatch,
    FaceNotIndexedError,
    FaceProvider,
    FaceProviderError,
    NoFaceInImageError,
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

# IndexFaces UnindexedFaces reasons -> our quality issues.
_UNINDEXED_REASONS = {
    "EXCEEDS_MAX_FACES": QualityIssue.MULTIPLE_FACES,
    "EXTREME_POSE": QualityIssue.BAD_POSE,
    "LOW_BRIGHTNESS": QualityIssue.TOO_DARK,
    "LOW_SHARPNESS": QualityIssue.BLURRY,
    "LOW_CONFIDENCE": QualityIssue.LOW_CONFIDENCE,
    "SMALL_BOUNDING_BOX": QualityIssue.TOO_SMALL,
    "LOW_FACE_QUALITY": QualityIssue.LOW_CONFIDENCE,
}


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

    def enroll(self, event_id: int, ticket_id: int, image: bytes) -> str:
        """IndexFaces: store one face vector tagged with the ticket (ExternalImageId)."""
        try:
            response = self._client.index_faces(
                CollectionId=collection_id_for(event_id),
                Image={"Bytes": image},
                ExternalImageId=str(ticket_id),
                MaxFaces=1,
                QualityFilter="AUTO",
                DetectionAttributes=[],
            )
        except ClientError as exc:
            code = _error_code(exc)
            if code in _BAD_IMAGE_ERRORS:
                raise InvalidImageError("image must be a JPEG or PNG up to 5 MB") from None
            if code == "ResourceNotFoundException":
                raise CollectionNotFoundError(collection_id_for(event_id)) from None
            raise FaceProviderError(f"index_faces failed: {code}") from None
        except BotoCoreError as exc:
            raise FaceProviderError(f"index_faces failed: {type(exc).__name__}") from None

        records = response.get("FaceRecords", [])
        if not records:
            reasons = [
                reason
                for unindexed in response.get("UnindexedFaces", [])
                for reason in unindexed.get("Reasons", [])
            ]
            issues = tuple(
                dict.fromkeys(_UNINDEXED_REASONS.get(r, QualityIssue.LOW_CONFIDENCE) for r in reasons)
            )
            raise FaceNotIndexedError(issues or (QualityIssue.NO_FACE,))
        return str(records[0]["Face"]["FaceId"])

    def search(self, event_id: int, image: bytes, threshold: float) -> FaceMatch | None:
        """SearchFacesByImage: best face in the event's collection at or above threshold."""
        try:
            response = self._client.search_faces_by_image(
                CollectionId=collection_id_for(event_id),
                Image={"Bytes": image},
                FaceMatchThreshold=threshold,
                MaxFaces=1,
            )
        except ClientError as exc:
            code = _error_code(exc)
            if code == "InvalidParameterException":  # Rekognition's answer for "no face in the image"
                raise NoFaceInImageError() from None
            if code in _BAD_IMAGE_ERRORS:
                raise InvalidImageError("image must be a JPEG or PNG up to 5 MB") from None
            if code == "ResourceNotFoundException":
                raise CollectionNotFoundError(collection_id_for(event_id)) from None
            raise FaceProviderError(f"search_faces_by_image failed: {code}") from None
        except BotoCoreError as exc:
            raise FaceProviderError(f"search_faces_by_image failed: {type(exc).__name__}") from None

        for match in response.get("FaceMatches", []):  # sorted by similarity, best first
            face = match["Face"]
            external_id = str(face.get("ExternalImageId", ""))
            if not external_id.isdigit():
                continue  # not one of our faces (e.g. added by hand in the console)
            return FaceMatch(
                ticket_id=int(external_id), face_id=str(face["FaceId"]), similarity=float(match["Similarity"])
            )
        return None

    def delete_face(self, event_id: int, face_id: str) -> None:
        """DeleteFaces for one face. Already gone (face or whole collection) counts as success."""
        try:
            response = self._client.delete_faces(CollectionId=collection_id_for(event_id), FaceIds=[face_id])
        except ClientError as exc:
            if _error_code(exc) == "ResourceNotFoundException":
                return
            raise FaceProviderError(f"delete_faces failed: {_error_code(exc)}") from None
        except BotoCoreError as exc:
            raise FaceProviderError(f"delete_faces failed: {type(exc).__name__}") from None

        for failure in response.get("UnsuccessfulFaceDeletions", []):
            reasons = [str(r) for r in failure.get("Reasons", []) if r != "FACE_NOT_FOUND"]
            if reasons:
                raise FaceProviderError(f"delete_faces failed: {', '.join(reasons)}")
