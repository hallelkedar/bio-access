from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.access_log import AccessMethod, AccessReason, AccessResult
from app.models.user import UserRole
from app.schemas.user import UserRead


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


class EntryBucket(BaseModel):
    bucket_start: datetime
    approved: int


class DecisionBreakdown(BaseModel):
    approved: int
    denied: int
    denied_by_reason: dict[AccessReason, int]
    approved_by_method: dict[AccessMethod, int]


class Occupancy(BaseModel):
    entered: int
    sold: int
    capacity: int
    percent: float


class EventStats(BaseModel):
    event_id: int
    entries_per_30_min: list[EntryBucket]
    decisions: DecisionBreakdown
    occupancy: Occupancy


MIN_FACE_MATCH_THRESHOLD = 80.0  # below this, strangers start getting in (false accepts)


class SettingsUpdate(BaseModel):
    face_match_threshold: float = Field(ge=MIN_FACE_MATCH_THRESHOLD, le=100.0)


class SettingsRead(BaseModel):
    face_match_threshold: float
    default_face_match_threshold: float
    source: Literal["database", "default"]


class UserFilters(BaseModel):
    """Query parameters of GET /api/admin/users (all optional)."""

    model_config = ConfigDict(extra="forbid")

    role: UserRole | None = None
    q: str | None = Field(default=None, min_length=1, max_length=100, description="part of email or name")
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class UserPage(BaseModel):
    items: list[UserRead]
    total: int
    limit: int
    offset: int
