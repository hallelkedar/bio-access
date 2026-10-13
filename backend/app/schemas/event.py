from datetime import datetime, timedelta

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.core.config import get_settings

from app.models.event import EventStatus

Currency = Field(default="ILS", pattern=r"^[A-Z]{3}$")

LOCATION_FORMAT_ERROR = "location must look like 'Venue, City'"


def is_venue_city(location: str) -> bool:
    """'Expo Tel Aviv, Tel Aviv' yes; 'asdf', 'Here,' or ', Haifa' no.

    A cheap server-side guard so the API can't bypass the form's city picker. The city
    itself isn't checked against a list: that list lives in the frontend.
    """
    venue, comma, city = location.rpartition(",")
    return bool(comma) and bool(venue.strip()) and bool(city.strip())


class EventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=255)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    capacity: int = Field(gt=0)
    price_cents: int = Field(ge=0)
    currency: str = Currency

    @field_validator("location")
    @classmethod
    def venue_and_city(cls, location: str) -> str:
        if not is_venue_city(location):
            raise ValueError(LOCATION_FORMAT_ERROR)
        return location

    @model_validator(mode="after")
    def ends_after_starts(self) -> "EventCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class EventUpdate(BaseModel):
    """Partial update: only the fields that are sent are changed.

    `location` is checked in the service, and only when it really changes, so an old
    event like "Here" can still be edited without retyping its location.
    """

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

    @computed_field
    @property
    def gate_opens_at(self) -> datetime:
        """When gates start admitting (GATE_OPENS_MINUTES_BEFORE before the start), as the gate checks it."""
        return self.starts_at - timedelta(minutes=get_settings().gate_opens_minutes_before)
