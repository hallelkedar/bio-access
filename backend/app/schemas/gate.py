from pydantic import BaseModel, Field

from app.models.access_log import AccessReason, AccessResult


class GateVerifyResult(BaseModel):
    result: AccessResult
    reason: AccessReason
    ticket_id: int | None = None
    user_name: str | None = None
    similarity: float | None = None


class GateQrVerify(BaseModel):
    event_id: int
    gate_id: str = Field(min_length=1, max_length=64)
    qr_token: str = Field(min_length=1, max_length=64)
