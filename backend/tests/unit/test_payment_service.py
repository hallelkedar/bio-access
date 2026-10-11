from collections.abc import Callable

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.providers.payment.fake import FakePaymentProvider
from app.services import payment as payment_service
from app.services import ticket as ticket_service

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


def test_checkout_returns_url_and_records_payment(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    user = make_user()
    event = make_event(EventStatus.ACTIVE, price_cents=7500, currency="ILS")
    ticket = ticket_service.create_ticket(db, user, event.id)

    session = payment_service.start_checkout(db, FakePaymentProvider(), user, ticket.id)

    assert session.url.endswith(session.session_id)
    payment = db.scalars(select(Payment).where(Payment.ticket_id == ticket.id)).one()
    assert payment.provider == "fake"
    assert payment.provider_session_id == session.session_id
    assert payment.amount_cents == 7500
    assert payment.currency == "ILS"
    assert payment.status == PaymentStatus.CREATED
    assert payment.provider_event_id is None


def test_missing_ticket_not_found(db: Session, make_user: MakeUser) -> None:
    with pytest.raises(payment_service.TicketNotFoundError):
        payment_service.start_checkout(db, FakePaymentProvider(), make_user(), 999_999)


def test_other_users_ticket_not_found(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    event = make_event(EventStatus.ACTIVE)
    ticket = ticket_service.create_ticket(db, make_user(), event.id)

    with pytest.raises(payment_service.TicketNotFoundError):
        payment_service.start_checkout(db, FakePaymentProvider(), make_user(), ticket.id)


@pytest.mark.parametrize(
    "status", [TicketStatus.VALID, TicketStatus.ENTERED, TicketStatus.CANCELLED]
)
def test_only_pending_tickets_are_payable(
    db: Session, make_user: MakeUser, make_event: MakeEvent, status: TicketStatus
) -> None:
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    ticket.status = status
    db.commit()

    with pytest.raises(payment_service.TicketNotPayableError):
        payment_service.start_checkout(db, FakePaymentProvider(), user, ticket.id)
    assert db.scalars(select(Payment).where(Payment.ticket_id == ticket.id)).first() is None
