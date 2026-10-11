import secrets

from sqlalchemy.orm import Session

from app.models.event import Event
from app.providers.storage.base import StorageService
from app.services import event as event_service
from app.utils.image_validation import validate_image


def upload_event_cover(
    db: Session, storage: StorageService, event_id: int, data: bytes, max_bytes: int
) -> Event:
    """Validate the image, store it under a random key, and set it as the event's cover.

    Raises EventNotFoundError, ImageTooLargeError or InvalidImageError.
    """
    event = event_service.get_event(db, event_id)
    image = validate_image(data, max_bytes)
    key = f"event-covers/{event_id}/{secrets.token_hex(8)}.{image.extension}"
    event.cover_image_url = storage.upload(key, data, image.content_type)
    db.commit()
    return event
