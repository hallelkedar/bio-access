import hashlib
import secrets

from app.providers.face.base import (
    CollectionNotFoundError,
    FaceMatch,
    FaceProvider,
    FaceProviderError,
    QualityResult,
    collection_id_for,
)

EXACT_MATCH_SIMILARITY = 99.9


def _fingerprint(image: bytes) -> str:
    return hashlib.sha256(image).hexdigest()


class FakeFaceProvider(FaceProvider):
    """In-memory provider for tests: a "face" is identified by the image's SHA-256.

    The same bytes match (similarity 99.9); anything else does not. Images
    themselves are never kept, only their hashes.
    """

    def __init__(self) -> None:
        # collection_id -> face_id -> (ticket_id, fingerprint)
        self._collections: dict[str, dict[str, tuple[int, str]]] = {}
        self._quality: dict[str, QualityResult] = {}
        self._similarity: dict[str, float] = {}
        self.available = True

    # --- test controls -------------------------------------------------
    def set_quality(self, image: bytes, result: QualityResult) -> None:
        self._quality[_fingerprint(image)] = result

    def set_similarity(self, image: bytes, similarity: float) -> None:
        """When this image is searched, report this similarity for the enrolled face it matches."""
        self._similarity[_fingerprint(image)] = similarity

    # --- FaceProvider --------------------------------------------------
    def ensure_collection(self, event_id: int) -> str:
        self._check_available()
        collection_id = collection_id_for(event_id)
        self._collections.setdefault(collection_id, {})
        return collection_id

    def check_quality(self, image: bytes) -> QualityResult:
        self._check_available()
        return self._quality.get(_fingerprint(image), QualityResult())

    def enroll(self, event_id: int, ticket_id: int, image: bytes) -> str:
        faces = self._faces(event_id)
        face_id = secrets.token_hex(16)
        faces[face_id] = (ticket_id, _fingerprint(image))
        return face_id

    def search(self, event_id: int, image: bytes, threshold: float) -> FaceMatch | None:
        faces = self._faces(event_id)
        fingerprint = _fingerprint(image)
        similarity = self._similarity.get(fingerprint, EXACT_MATCH_SIMILARITY)
        for face_id, (ticket_id, enrolled) in faces.items():
            if enrolled == fingerprint and similarity >= threshold:
                return FaceMatch(ticket_id=ticket_id, face_id=face_id, similarity=similarity)
        return None

    def delete_face(self, event_id: int, face_id: str) -> None:
        self._faces(event_id).pop(face_id, None)

    def delete_collection(self, event_id: int) -> None:
        self._check_available()
        self._collections.pop(collection_id_for(event_id), None)

    # --- helpers -------------------------------------------------------
    def face_count(self, event_id: int) -> int:
        return len(self._collections.get(collection_id_for(event_id), {}))

    def _faces(self, event_id: int) -> dict[str, tuple[int, str]]:
        self._check_available()
        faces = self._collections.get(collection_id_for(event_id))
        if faces is None:
            raise CollectionNotFoundError(collection_id_for(event_id))
        return faces

    def _check_available(self) -> None:
        if not self.available:
            raise FaceProviderError("fake face provider is unavailable")
