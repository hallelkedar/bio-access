from typing import Any, Literal

from pydantic import BaseModel, Field


class WsMessage(BaseModel):
    """Every message the server pushes to admin dashboards."""

    type: Literal["connected", "pong", "access_event", "stats_update"]
    payload: dict[str, Any] = Field(default_factory=dict)


class WsAuth(BaseModel):
    """First message a client must send: the JWT goes here, never in the URL (URLs get logged)."""

    type: Literal["auth"]
    token: str = Field(min_length=1)
