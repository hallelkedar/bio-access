from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.event import EventCreate, EventRead, EventUpdate
from app.providers.storage import get_storage
from app.providers.storage.base import StorageService
from app.services import event as event_service
from app.services import storage as storage_service
from app.utils.image_validation import ImageTooLargeError, InvalidImageError

router = APIRouter(prefix="/api/events", tags=["events"])

require_admin = require_role(UserRole.ADMIN)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    data: EventCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> EventRead:
    return EventRead.model_validate(event_service.create_event(db, data, admin))


@router.get("", response_model=list[EventRead])
def list_catalog(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> list[EventRead]:
    return [EventRead.model_validate(event) for event in event_service.list_catalog(db)]


@router.get("/{event_id}", response_model=EventRead)
def get_event(
    event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> EventRead:
    try:
        return EventRead.model_validate(event_service.get_visible_event(db, event_id, user))
    except event_service.EventNotFoundError:
        raise _not_found()


@router.put("/{event_id}", response_model=EventRead)
def update_event(
    event_id: int,
    data: EventUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> EventRead:
    try:
        return EventRead.model_validate(event_service.update_event(db, event_id, data))
    except event_service.EventNotFoundError:
        raise _not_found()
    except event_service.InvalidEventError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> Response:
    try:
        event_service.delete_event(db, event_id)
    except event_service.EventNotFoundError:
        raise _not_found()
    except event_service.EventNotDeletableError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{event_id}/cover", response_model=EventRead)
def upload_cover(
    event_id: int,
    file: UploadFile = File(description="JPEG, PNG or WebP"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    storage: StorageService = Depends(get_storage),
) -> EventRead:
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = file.file.read(max_bytes + 1)  # one extra byte is enough to detect "too large"
    try:
        event = storage_service.upload_event_cover(db, storage, event_id, data, max_bytes)
    except event_service.EventNotFoundError:
        raise _not_found()
    except ImageTooLargeError as exc:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc))
    except InvalidImageError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc))
    return EventRead.model_validate(event)
