from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payment import Payment, PaymentStatus


def create(db: Session, payment: Payment) -> Payment:
    db.add(payment)
    db.flush()
    return payment


def get_by_session_id_for_update(db: Session, provider_session_id: str) -> Payment | None:
    """Load the payment and lock its row so concurrent webhooks for one session run in turn."""
    # populate_existing: refresh an object already in the session with the locked row's values.
    query = (
        select(Payment)
        .where(Payment.provider_session_id == provider_session_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return db.scalars(query).first()


def has_open_payment(db: Session, ticket_id: int, exclude_payment_id: int) -> bool:
    """Is another checkout for this ticket still waiting to be paid?"""
    query = select(Payment.id).where(
        Payment.ticket_id == ticket_id,
        Payment.id != exclude_payment_id,
        Payment.status == PaymentStatus.CREATED,
    )
    return db.scalars(query).first() is not None
