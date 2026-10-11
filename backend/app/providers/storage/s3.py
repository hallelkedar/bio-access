from typing import Any

import boto3

from app.providers.storage.base import StorageService


class S3Storage(StorageService):
    """AWS S3. The bucket policy must allow public GetObject on event-covers/* for the URLs to load."""

    def __init__(
        self,
        bucket: str,
        region: str,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        client: Any | None = None,
    ) -> None:
        self._bucket = bucket
        self._region = region
        self._client = client or boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",  # keys are never reused
        )
        return f"https://{self._bucket}.s3.{self._region}.amazonaws.com/{key}"
