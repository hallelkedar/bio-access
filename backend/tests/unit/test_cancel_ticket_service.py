from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.payment.base import CheckoutSession, PaymentProviderError, SessionStatus
from app.providers.payment.fake import FakePaymentProvider
from app.repositories import ticket_repository
from app.services import payment as payment_service
from app.services import ticket as ticket_service

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


@pytest.fixture
def provider() -> FakePaymentProvider:
    return FakePaymentProvider()


@pytest.fixture
def pending(db: Session, make_user: MakeUser, make_event: MakeEvent) -> tuple[User, Ticket]:
    user = make_user()
    return user, ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE, capacity=1).id)


def _payments(db: Session, ticket: Ticket) -> list[Payment]:
    payments = db.query(Payment).filter_by(ticket_id=ticket.id).order_by(Payment.id).all()
    for payment in payments:
        db.refresh(payment)
    return payments


def test_cancel_closes_every_checkout_and_frees_the_seat(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket]
) -> None:
    user, ticket = pending
    first = payment_service.start_checkout(db, provider, user, ticket.id).session_id
    second = payment_service.start_checkout(db, provider, user, ticket.id).session_id

    payment_service.cancel_pending_ticket(db, provider, user, ticket.id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.CANCELLED
    assert provider.get_session_status(first) == SessionStatus.EXPIRED
    assert provider.get_session_status(second) == SessionStatus.EXPIRED
    assert [p.status for p in _payments(db, ticket)] == [PaymentStatus.FAILED, PaymentStatus.FAILED]
    assert ticket_repository.count_reserved(db, ticket.event_id) == 0
    # The seat is free again (capacity 1) and the same user may buy again.
    assert ticket_service.create_ticket(db, user, ticket.event_id).status == TicketStatus.PENDING_PAYMENT


def test_cancel_without_any_checkout(db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket]) -> None:
    user, ticket = pending

    payment_service.cancel_pending_ticket(db, provider, user, ticket.id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.CANCELLED


def test_someone_elses_ticket_is_not_found(
    db: Session, make_user: MakeUser, provider: FakePaymentProvider, pending: tuple[User, Ticket]
) -> None:
    _, ticket = pending

    with pytest.raises(payment_service.TicketNotFoundError):
        payment_service.cancel_pending_ticket(db, provider, make_user(), ticket.id)


@pytest.mark.parametrize("status", [TicketStatus.VALID, TicketStatus.ENTERED, TicketStatus.CANCELLED])
def test_only_a_ticket_awaiting_payment_can_be_cancelled(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket], status: TicketStatus
) -> None:
    user, ticket = pending
    ticket.status = status
    db.commit()

    with pytest.raises(payment_service.TicketNotCancellableError):
        payment_service.cancel_pending_ticket(db, provider, user, ticket.id)
    db.refresh(ticket)
    assert ticket.status == status


def test_a_paid_checkout_activates_the_ticket_instead(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket]
) -> None:
    user, ticket = pending
    session_id = payment_service.start_checkout(db, provider, user, ticket.id).session_id
    provider.mark_paid(session_id)  # paid at Stripe a moment ago; the webhook hasn't arrived

    with pytest.raises(payment_service.TicketAlreadyPaidError) as raised:
        payment_service.cancel_pending_ticket(db, provider, user, ticket.id)

    assert raised.value.activated == ticket.id  # this call activated it: notify once
    db.refresh(ticket)
    assert ticket.status == TicketStatus.VALID
    [payment] = _payments(db, ticket)
    assert payment.status == PaymentStatus.PAID
    assert payment.provider_event_id == f"cancel:{session_id}"


def test_provider_down_changes_nothing(db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket]) -> None:
    user, ticket = pending
    payment_service.start_checkout(db, provider, user, ticket.id)
    down = MagicMock(wraps=provider)
    down.expire_checkout.side_effect = PaymentProviderError("timeout")

    with pytest.raises(PaymentProviderError):
        payment_service.cancel_pending_ticket(db, down, user, ticket.id)

    db.refresh(ticket)
    assert ticket.status == TicketStatus.PENDING_PAYMENT
    assert [p.status for p in _payments(db, ticket)] == [PaymentStatus.CREATED]


def test_checkout_racing_a_cancel_is_closed_and_refused(
    db: Session, provider: FakePaymentProvider, pending: tuple[User, Ticket]
) -> None:
    """The cancel commits while start_checkout is talking to the provider."""
    user, ticket = pending
    created: list[str] = []

    class CancelsMeanwhile(FakePaymentProvider):
        def create_checkout(self, **kwargs: object) -> CheckoutSession:  # type: ignore[override]
            session = provider.create_checkout(**kwargs)  # type: ignore[arg-type]
            created.append(session.session_id)
            payment_service.cancel_pending_ticket(db, provider, user, ticket.id)
            return session

        def expire_checkout(self, session_id: str) -> None:
            provider.expire_checkout(session_id)

    with pytest.raises(payment_service.TicketNotPayableError):
        payment_service.start_checkout(db, CancelsMeanwhile(), user, ticket.id)

    assert provider.get_session_status(created[0]) == SessionStatus.EXPIRED  # nobody can pay it
    assert _payments(db, ticket) == []
