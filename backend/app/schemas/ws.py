from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.access_log import AccessMethod, AccessReason, AccessResult


class WsMessage(BaseModel):
    """Every message the server pushes to admin dashboards."""

    type: Literal["connected", "pong", "access_event"]
    payload: dict[str, Any] = Field(default_factory=dict)


class WsAuth(BaseModel):
    """First message a client must send: the JWT goes here, never in the URL (URLs get logged)."""

    type: Literal["auth"]
    token: str = Field(min_length=1)


class AccessEventPayload(BaseModel):
    """One gate decision, as shown live on the admin dashboard."""

    event_id: int
    gate_id: str
    method: AccessMethod
    result: AccessResult
    reason: AccessReason
    ticket_id: int | None
    user_name: str | None
    similarity: float | None
    timestamp: datetime
