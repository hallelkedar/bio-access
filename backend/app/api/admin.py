from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.admin import AccessLogFilters, AccessLogPage, EventStats, RoleUpdate, SettingsRead, SettingsUpdate, UserFilters, UserPage
from app.schemas.event import EventRead
from app.schemas.user import UserRead
from app.services import admin_logs, admin_users, analytics
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
