from functools import lru_cache

from app.core.config import get_settings
from app.providers.storage.base import StorageService
from app.providers.storage.local_fake import LocalStorage
from app.providers.storage.s3 import S3Storage


@lru_cache
def get_storage() -> StorageService:
    """Pick storage from STORAGE_PROVIDER in .env (FastAPI dependency)."""
    settings = get_settings()
    if settings.storage_provider == "s3":
        if not settings.s3_bucket:
            raise RuntimeError("STORAGE_PROVIDER=s3 requires S3_BUCKET in .env")
        return S3Storage(
            settings.s3_bucket,
            settings.aws_region,
            settings.aws_access_key_id,
            settings.aws_secret_access_key,
        )
    return LocalStorage(settings.local_media_dir)
