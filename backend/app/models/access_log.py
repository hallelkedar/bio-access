import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccessResult(str, enum.Enum):
    APPROVED = "APPROVED"
    DENIED = "DENIED"


class AccessReason(str, enum.Enum):
    NONE = "NONE"
    NOT_RECOGNIZED = "NOT_RECOGNIZED"
    ALREADY_ENTERED = "ALREADY_ENTERED"
    EVENT_NOT_ACTIVE = "EVENT_NOT_ACTIVE"
    LIVENESS_FAILED = "LIVENESS_FAILED"
    CANCELLED = "CANCELLED"
    LOW_QUALITY = "LOW_QUALITY"
    PROVIDER_ERROR = "PROVIDER_ERROR"


class AccessMethod(str, enum.Enum):
    FACE = "FACE"
    QR = "QR"


class AccessLog(Base):
    __tablename__ = "access_logs"
    __table_args__ = (Index("ix_access_logs_event_id_timestamp", "event_id", "timestamp"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"))
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    gate_id: Mapped[str] = mapped_column(String(64))
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    result: Mapped[AccessResult] = mapped_column(Enum(AccessResult, name="access_result"))
    reason: Mapped[AccessReason] = mapped_column(
        Enum(AccessReason, name="access_reason"), default=AccessReason.NONE
    )
    similarity: Mapped[float | None]
    method: Mapped[AccessMethod] = mapped_column(Enum(AccessMethod, name="access_method"))
