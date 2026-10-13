from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.providers.face import get_face_provider
from app.providers.face.base import FaceProvider, FaceProviderError
from app.schemas.admin import AccessLogFilters, AccessLogPage, BiometricPurgeRead, EventStats, RoleUpdate, SettingsRead, SettingsUpdate, UserFilters, UserPage
from app.schemas.event import EventRead
from app.schemas.user import UserRead
from app.services import admin_logs, admin_users, analytics, biometrics
from app.services import event as event_service
from app.services import settings as settings_service
from app.services.event import EventNotFoundError

router = APIRouter(prefix="/api/admin", tags=["admin"])

require_admin = require_role(UserRole.ADMIN)


@router.get("/logs", response_model=AccessLogPage)
def list_logs(
    filters: Annotated[AccessLogFilters, Query()],
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> AccessLogPage:
    try:
        return admin_logs.list_logs(db, filters)
    except admin_logs.InvalidRangeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("/stats/{event_id}", response_model=EventStats)
def event_stats(
    event_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> EventStats:
    try:
        return analytics.event_stats(db, event_id)
    except EventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")


@router.get("/settings", response_model=SettingsRead)
def get_settings_view(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> SettingsRead:
    return settings_service.get_threshold_info(db)


@router.put("/settings", response_model=SettingsRead)
def update_settings(
    data: SettingsUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> SettingsRead:
    return settings_service.set_face_match_threshold(db, data.face_match_threshold, admin)


@router.get("/users", response_model=UserPage)
def list_users(
    filters: Annotated[UserFilters, Query()],
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> UserPage:
    return admin_users.list_users(db, filters)


@router.get("/events", response_model=list[EventRead])
def list_all_events(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[EventRead]:
    return [EventRead.model_validate(event) for event in event_service.list_all_events(db)]


@router.post("/events/{event_id}/purge-biometrics", response_model=BiometricPurgeRead)
def purge_biometrics(
    event_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    face_provider: FaceProvider = Depends(get_face_provider),
) -> BiometricPurgeRead:
    try:
        return biometrics.purge_event_biometrics(db, face_provider, event_id, admin)
    except EventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    except biometrics.EventStillOpenError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="close the event (or wait until it ends) first"
        )
    except FaceProviderError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="face service unavailable, try again"
        )


@router.patch("/users/{user_id}/role", response_model=UserRead)
def change_user_role(
    user_id: int, data: RoleUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> UserRead:
    try:
        return admin_users.change_role(db, admin, user_id, data.role)
    except admin_users.OwnRoleChangeError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="you can't change your own role")
    except admin_users.UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
