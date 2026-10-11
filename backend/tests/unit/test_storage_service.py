from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.services import storage as storage_service
from app.services.event import EventNotFoundError
from app.utils.image_validation import InvalidImageError
from tests.fakes import InMemoryStorage
from tests.images import image_bytes

MakeEvent = Callable[..., Event]
MB = 1024 * 1024


def test_upload_sets_cover_url(db: Session, make_event: MakeEvent) -> None:
    event = make_event()
    storage = InMemoryStorage()

    updated = storage_service.upload_event_cover(db, storage, event.id, image_bytes("JPEG"), MB)

    [(key, (_, content_type))] = storage.files.items()
    assert key.startswith(f"event-covers/{event.id}/") and key.endswith(".jpg")
    assert content_type == "image/jpeg"
    assert updated.cover_image_url == f"https://storage.test/{key}"


def test_each_upload_gets_a_new_key(db: Session, make_event: MakeEvent) -> None:
    event = make_event()
    storage = InMemoryStorage()

    storage_service.upload_event_cover(db, storage, event.id, image_bytes(), MB)
    storage_service.upload_event_cover(db, storage, event.id, image_bytes(), MB)

    assert len(storage.files) == 2


def test_invalid_image_not_uploaded(db: Session, make_event: MakeEvent) -> None:
    event = make_event()
    storage = InMemoryStorage()

    with pytest.raises(InvalidImageError):
        storage_service.upload_event_cover(db, storage, event.id, b"not an image", MB)
    assert storage.files == {}
    assert event.cover_image_url is None


def test_unknown_event(db: Session) -> None:
    with pytest.raises(EventNotFoundError):
        storage_service.upload_event_cover(db, InMemoryStorage(), 999_999, image_bytes(), MB)
