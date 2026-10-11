import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


def collection_id_for(event_id: int) -> str:
    """One face collection per event."""
    return f"bioaccess-event-{event_id}"


class QualityIssue(str, enum.Enum):
    NO_FACE = "NO_FACE"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    TOO_DARK = "TOO_DARK"
    BLURRY = "BLURRY"
    BAD_POSE = "BAD_POSE"
    TOO_SMALL = "TOO_SMALL"  # face too far from the camera


@dataclass(frozen=True)
class QualityResult:
    issues: tuple[QualityIssue, ...] = field(default=())

    @property
    def ok(self) -> bool:
        return not self.issues


@dataclass(frozen=True)
class FaceMatch:
    ticket_id: int
    face_id: str
    similarity: float  # 0-100


class FaceProviderError(Exception):
    """The provider is unreachable or failed (maps to PROVIDER_ERROR / QR fallback)."""


class CollectionNotFoundError(FaceProviderError):
    pass


class NoFaceInImageError(Exception):
    """The searched image has no detectable face (a bad frame, not an outage)."""


class FaceNotIndexedError(Exception):
    """The provider found the photo unusable at indexing time (a quality problem, not an outage)."""

    def __init__(self, issues: tuple[QualityIssue, ...]) -> None:
        super().__init__(", ".join(issue.value for issue in issues))
        self.issues = issues


class FaceProvider(ABC):
    """Face recognition backend.

    Images are passed as in-memory bytes; implementations must never persist
    or log them. Only face ids and ticket ids leave this layer.
    """

    @abstractmethod
    def ensure_collection(self, event_id: int) -> str:
        """Create the event's collection if missing (idempotent); return its id."""

    @abstractmethod
    def check_quality(self, image: bytes) -> QualityResult:
        """Is this a usable enrollment photo (exactly one clear, well-lit, frontal face)?"""

    @abstractmethod
    def enroll(self, event_id: int, ticket_id: int, image: bytes) -> str:
        """Index the face into the event's collection, tagged with ticket_id; return face_id."""

    @abstractmethod
    def search(self, event_id: int, image: bytes, threshold: float) -> FaceMatch | None:
        """Best match in the event's collection with similarity >= threshold, or None."""

    @abstractmethod
    def delete_face(self, event_id: int, face_id: str) -> None:
        """Remove one face from the event's collection (no error if already gone)."""

    @abstractmethod
    def delete_collection(self, event_id: int) -> None:
        """Remove the event's collection and every face in it (no error if already gone)."""
