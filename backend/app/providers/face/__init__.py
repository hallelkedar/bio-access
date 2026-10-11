from functools import lru_cache

from app.core.config import get_settings
from app.providers.face.base import FaceProvider
from app.providers.face.demo import DemoFaceProvider
from app.providers.face.fake import FakeFaceProvider
from app.providers.face.rekognition import RekognitionFaceProvider


@lru_cache
def get_face_provider() -> FaceProvider:
    """Pick the face provider from FACE_PROVIDER in .env (FastAPI dependency)."""
    settings = get_settings()
    if settings.face_provider == "rekognition":
        if not (settings.aws_access_key_id and settings.aws_secret_access_key):
            raise RuntimeError(
                "FACE_PROVIDER=rekognition requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env"
            )
        return RekognitionFaceProvider(
            settings.aws_region, settings.aws_access_key_id, settings.aws_secret_access_key
        )
    if settings.face_provider == "demo":
        return DemoFaceProvider(settings.demo_faces_file)
    return FakeFaceProvider()
