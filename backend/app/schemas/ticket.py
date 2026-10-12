from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.event import EventStatus
from app.models.ticket import TicketStatus


class TicketCreate(BaseModel):
    event_id: int


class TicketRead(BaseModel):
    """Ticket without its qr_token (exposed only once the ticket is paid)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    status: TicketStatus
    purchased_at: datetime
    entered_at: datetime | None


class EventSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: str
    starts_at: datetime
    ends_at: datetime
    status: EventStatus  # a VALID ticket of a CLOSED event must not look usable
    cover_image_url: str | None


class MyTicketRead(TicketRead):
    event: EventSummary
    qr_token: str | None
    enrolled: bool  # a face is already bound to this ticket


class CheckoutRead(BaseModel):
    checkout_url: str


class PaymentRefreshRead(BaseModel):
    status: TicketStatus
