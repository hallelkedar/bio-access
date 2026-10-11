from sqlalchemy.orm import Session

from app.providers.face.base import FaceMatch, FaceProvider
from app.services.settings import get_face_match_threshold


def identify(db: Session, face_provider: FaceProvider, event_id: int, image: bytes) -> FaceMatch | None:
    """Who is this, among the faces enrolled for this event? None if nobody reaches the threshold.

    Raises NoFaceInImageError (bad frame), CollectionNotFoundError, FaceProviderError.
    Does not check tickets: the gate's access control does that.
    """
    return face_provider.search(event_id, image, get_face_match_threshold(db))
