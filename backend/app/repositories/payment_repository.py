from sqlalchemy.orm import Session

from app.models.payment import Payment


def create(db: Session, payment: Payment) -> Payment:
    db.add(payment)
    db.flush()
    return payment
