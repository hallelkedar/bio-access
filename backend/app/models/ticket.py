import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TicketStatus(str, enum.Enum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    VALID = "VALID"
    ENTERED = "ENTERED"
    CANCELLED = "CANCELLED"


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_tickets_event_user"),
        Index("ix_tickets_event_id_status", "event_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    qr_token: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[TicketStatus] = mapped_column(
        Enum(TicketStatus, name="ticket_status"), default=TicketStatus.PENDING_PAYMENT
    )
    purchased_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
