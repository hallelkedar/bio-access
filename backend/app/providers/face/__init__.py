from functools import lru_cache

from app.core.config import get_settings
from app.providers.face.base import FaceProvider
from app.providers.face.fake import FakeFaceProvider


@lru_cache
def get_face_provider() -> FaceProvider:
    """Pick the face provider from FACE_PROVIDER in .env (FastAPI dependency)."""
    name = get_settings().face_provider
    if name == "fake":
        return FakeFaceProvider()
    raise NotImplementedError(f"face provider {name!r} is not implemented yet")
