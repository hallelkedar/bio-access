from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.payment.base import InvalidWebhookError
from app.providers.payment.fake import FakePaymentProvider
from app.services import payment as payment_service
from app.services import ticket as ticket_service

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


@pytest.fixture
def provider() -> FakePaymentProvider:
    return FakePaymentProvider()


@pytest.fixture
def pending(
    db: Session, make_user: MakeUser, make_event: MakeEvent, provider: FakePaymentProvider
) -> tuple[User, Ticket, str]:
    """A PENDING_PAYMENT ticket with one open checkout; returns (user, ticket, session_id)."""
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    session = payment_service.start_checkout(db, provider, user, ticket.id)
    return user, ticket, session.session_id


def _payment(db: Session, session_id: str) -> Payment:
    payment = db.query(Payment).filter_by(provider_session_id=session_id).one()
    db.refresh(payment)
    return payment


def _send(db: Session, provider: FakePaymentProvider, event_type: str, session_id: str, event_id: str | None = None) -> None:
    payload, headers = provider.build_webhook(event_type, session_id, event_id)
    payment_service.handle_webhook(db, provider, payload, headers)


def test_success_marks_paid_and_ticket_valid(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    _, ticket, session_id = pending

    _send(db, provider, "payment.succeeded", session_id, "evt_1")

    db.refresh(ticket)
    payment = _payment(db, session_id)
    assert ticket.status == TicketStatus.VALID
    assert payment.status == PaymentStatus.PAID
    assert payment.provider_event_id == "evt_1"


def test_same_webhook_twice_has_one_effect(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    _, ticket, session_id = pending
    payload, headers = provider.build_webhook("payment.succeeded", session_id, "evt_1")
    payment_service.handle_webhook(db, provider, payload, headers)
    ticket.status = TicketStatus.ENTERED  # e.g. the user already went in
    db.commit()

    payment_service.handle_webhook(db, provider, payload, headers)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.ENTERED
    assert _payment(db, session_id).provider_event_id == "evt_1"


def test_failure_after_success_is_ignored(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    _, ticket, session_id = pending
    _send(db, provider, "payment.succeeded", session_id)

    _send(db, provider, "payment.failed", session_id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.VALID
    assert _payment(db, session_id).status == PaymentStatus.PAID


def test_bad_signature_rejected_without_changes(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    _, ticket, session_id = pending
    payload, _ = provider.build_webhook("payment.succeeded", session_id)

    with pytest.raises(InvalidWebhookError):
        payment_service.handle_webhook(db, provider, payload, {"x-fake-signature": "forged"})

    db.refresh(ticket)
    assert ticket.status == TicketStatus.PENDING_PAYMENT
    assert _payment(db, session_id).status == PaymentStatus.CREATED


def test_failure_cancels_ticket_and_frees_seat(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    _, ticket, session_id = pending

    _send(db, provider, "payment.failed", session_id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.CANCELLED
    assert _payment(db, session_id).status == PaymentStatus.FAILED


def test_failure_keeps_ticket_while_another_checkout_is_open(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    user, ticket, old_session_id = pending
    payment_service.start_checkout(db, provider, user, ticket.id)  # user retried

    _send(db, provider, "payment.failed", old_session_id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.PENDING_PAYMENT
    assert _payment(db, old_session_id).status == PaymentStatus.FAILED


def test_unknown_session_is_ignored(db: Session, provider: FakePaymentProvider) -> None:
    _send(db, provider, "payment.succeeded", "fake_cs_unknown")  # no error


def test_unhandled_event_type_is_ignored(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket, str]
) -> None:
    _, ticket, session_id = pending

    _send(db, provider, "customer.created", session_id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.PENDING_PAYMENT
