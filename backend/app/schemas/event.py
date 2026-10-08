from datetime import datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.models.event import EventStatus

Currency = Field(default="ILS", pattern=r"^[A-Z]{3}$")


class EventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=255)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    capacity: int = Field(gt=0)
    price_cents: int = Field(ge=0)
    currency: str = Currency

    @model_validator(mode="after")
    def ends_after_starts(self) -> "EventCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class EventUpdate(BaseModel):
    """Partial update: only the fields that are sent are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    location: str | None = Field(default=None, min_length=1, max_length=255)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    capacity: int | None = Field(default=None, gt=0)
    price_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    status: EventStatus | None = None


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: str
    cover_image_url: str | None
    starts_at: datetime
    ends_at: datetime
    capacity: int
    price_cents: int
    currency: str
    status: EventStatus
    created_by: int
