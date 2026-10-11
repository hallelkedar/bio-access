from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.admin import AccessLogFilters, AccessLogPage, EventStats, SettingsRead, SettingsUpdate, UserFilters, UserPage
from app.services import admin_logs, admin_users, analytics
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
