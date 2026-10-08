from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.event import EventCreate, EventRead, EventUpdate
from app.services import event as event_service

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
