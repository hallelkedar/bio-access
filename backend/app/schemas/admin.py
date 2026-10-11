from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.access_log import AccessMethod, AccessReason, AccessResult


class AccessLogFilters(BaseModel):
    """Query parameters of GET /api/admin/logs (all optional)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    event_id: int | None = None
    result: AccessResult | None = None
    reason: AccessReason | None = None
    method: AccessMethod | None = None
    gate_id: str | None = Field(default=None, max_length=64)
    from_: datetime | None = Field(default=None, alias="from", description="inclusive")
    to: datetime | None = Field(default=None, description="exclusive")
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class AccessLogRead(BaseModel):
    id: int
    timestamp: datetime
    event_id: int
    gate_id: str
    method: AccessMethod
    result: AccessResult
    reason: AccessReason
    similarity: float | None
    ticket_id: int | None
    user_name: str | None


class AccessLogPage(BaseModel):
    items: list[AccessLogRead]
    total: int
    limit: int
    offset: int
