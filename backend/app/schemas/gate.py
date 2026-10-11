from pydantic import BaseModel

from app.models.access_log import AccessReason, AccessResult


class GateVerifyResult(BaseModel):
    result: AccessResult
    reason: AccessReason
    ticket_id: int | None = None
    user_name: str | None = None
    similarity: float | None = None
