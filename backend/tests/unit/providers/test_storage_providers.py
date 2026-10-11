from collections.abc import Iterator
from pathlib import Path

import boto3
import pytest
from botocore.stub import Stubber

from app.core.config import Settings
from app.providers import storage as storage_providers
from app.providers.storage.local_fake import LocalStorage
from app.providers.storage.s3 import S3Storage


def test_local_storage_writes_file_and_returns_media_url(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path, "http://localhost:8000/")

    url = storage.upload("event-covers/1/abc.png", b"data", "image/png")

    assert url == "http://localhost:8000/media/event-covers/1/abc.png"
    assert (tmp_path / "event-covers/1/abc.png").read_bytes() == b"data"


def test_local_storage_rejects_path_escape(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        LocalStorage(tmp_path / "media", "http://x").upload("../evil.png", b"x", "image/png")


def test_s3_storage_puts_object_and_returns_url() -> None:
    client = boto3.client("s3", region_name="eu-west-1", aws_access_key_id="x", aws_secret_access_key="y")
    stubber = Stubber(client)
    stubber.add_response(
        "put_object",
        {},
        {
            "Bucket": "bioaccess-test",
            "Key": "event-covers/1/abc.png",
            "Body": b"data",
            "ContentType": "image/png",
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )

    with stubber:
        url = S3Storage("bioaccess-test", "eu-west-1", client=client).upload(
            "event-covers/1/abc.png", b"data", "image/png"
        )

    assert url == "https://bioaccess-test.s3.eu-west-1.amazonaws.com/event-covers/1/abc.png"
    stubber.assert_no_pending_responses()


@pytest.fixture
def _clear_cache() -> Iterator[None]:
    storage_providers.get_storage.cache_clear()
    yield
    storage_providers.get_storage.cache_clear()


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    settings = Settings(**overrides)  # type: ignore[arg-type]
    monkeypatch.setattr(storage_providers, "get_settings", lambda: settings)


@pytest.mark.usefixtures("_clear_cache")
def test_factory_local(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, storage_provider="local")

    assert isinstance(storage_providers.get_storage(), LocalStorage)


@pytest.mark.usefixtures("_clear_cache")
def test_factory_s3(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, storage_provider="s3", s3_bucket="b", aws_access_key_id="x", aws_secret_access_key="y")

    assert isinstance(storage_providers.get_storage(), S3Storage)


@pytest.mark.usefixtures("_clear_cache")
def test_factory_s3_without_bucket_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, storage_provider="s3", s3_bucket=None)

    with pytest.raises(RuntimeError, match="S3_BUCKET"):
        storage_providers.get_storage()
