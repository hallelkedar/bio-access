"""Cancel vs a webhook in flight: real separate connections, not the rollback fixture."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.payment.fake import FakePaymentProvider
from app.services import payment as payment_service
from app.services import ticket as ticket_service


def test_cancel_backs_off_while_a_webhook_holds_the_payment(engine: Engine) -> None:
    provider = FakePaymentProvider()
    with Session(engine) as setup:
        admin = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com", full_name="A", password_hash="x", role=UserRole.ADMIN)
        buyer = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com", full_name="B", password_hash="x", role=UserRole.USER)
        setup.add_all([admin, buyer])
        setup.flush()
        starts_at = datetime.now(UTC) + timedelta(days=1)
        event = Event(name="Race", location="Here", starts_at=starts_at, ends_at=starts_at + timedelta(hours=2),
                      capacity=5, price_cents=1000, currency="ILS", status=EventStatus.ACTIVE, created_by=admin.id)
        setup.add(event)
        setup.commit()
        ticket = ticket_service.create_ticket(setup, buyer, event.id)
        payment_service.start_checkout(setup, provider, buyer, ticket.id)
        ids = {"event": event.id, "ticket": ticket.id, "users": [admin.id, buyer.id], "buyer": buyer.id}

    try:
        with Session(engine) as webhook, Session(engine) as canceller:
            # The webhook path locks the payment row first (then it would want the ticket).
            webhook.scalars(select(Payment).where(Payment.ticket_id == ids["ticket"]).with_for_update()).one()

            buyer = canceller.get(User, ids["buyer"])
            assert buyer is not None
            with pytest.raises(payment_service.PaymentInProgressError):
                payment_service.cancel_pending_ticket(canceller, provider, buyer, ids["ticket"])
            webhook.rollback()

        with Session(engine) as check:
            ticket = check.get(Ticket, ids["ticket"])
            assert ticket is not None and ticket.status == TicketStatus.PENDING_PAYMENT  # untouched
            payment = check.scalars(select(Payment).where(Payment.ticket_id == ids["ticket"])).one()
            assert payment.status == PaymentStatus.CREATED

            # Once the lock is gone, the same cancel goes through.
            buyer = check.get(User, ids["buyer"])
            assert buyer is not None
            payment_service.cancel_pending_ticket(check, provider, buyer, ids["ticket"])
            check.refresh(ticket)
            assert ticket.status == TicketStatus.CANCELLED
    finally:
        with Session(engine) as cleanup:
            cleanup.execute(delete(Payment).where(Payment.ticket_id == ids["ticket"]))
            cleanup.execute(delete(Ticket).where(Ticket.event_id == ids["event"]))
            cleanup.execute(delete(Event).where(Event.id == ids["event"]))
            cleanup.execute(delete(User).where(User.id.in_(ids["users"])))
            cleanup.commit()
