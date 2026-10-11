from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.admin import AccessLogFilters, AccessLogPage
from app.services import admin_logs

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
