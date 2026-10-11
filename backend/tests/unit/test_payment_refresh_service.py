from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.providers.payment.base import PaymentProviderError
from app.providers.payment.fake import FakePaymentProvider
from app.services import payment as payment_service
from app.services import ticket as ticket_service

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


@pytest.fixture
def provider() -> FakePaymentProvider:
    return FakePaymentProvider()


@pytest.fixture
def checkout(
    db: Session, make_user: MakeUser, make_event: MakeEvent, provider: FakePaymentProvider
) -> tuple[User, Ticket, str]:
    user = make_user()
    ticket = ticket_service.create_ticket(db, user, make_event(EventStatus.ACTIVE).id)
    session_id = payment_service.start_checkout(db, provider, user, ticket.id).session_id
    return user, ticket, session_id


def _payment(db: Session, session_id: str) -> Payment:
    payment = db.query(Payment).filter_by(provider_session_id=session_id).one()
    db.refresh(payment)
    return payment


def test_paid_session_activates_ticket(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str]
) -> None:
    user, ticket, session_id = checkout
    provider.mark_paid(session_id)  # paid at Stripe, webhook never arrived

    status, activated = payment_service.refresh_payment(db, provider, user, ticket.id)

    assert (status, activated) == (TicketStatus.VALID, ticket.id)
    payment = _payment(db, session_id)
    assert payment.status == PaymentStatus.PAID
    assert payment.provider_event_id == f"reconcile:{session_id}"


@pytest.mark.parametrize("mark", ["open", "expired"])
def test_unpaid_or_expired_session_changes_nothing(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str], mark: str
) -> None:
    user, ticket, session_id = checkout
    if mark == "expired":
        provider.mark_expired(session_id)

    status, activated = payment_service.refresh_payment(db, provider, user, ticket.id)

    assert (status, activated) == (TicketStatus.PENDING_PAYMENT, None)
    assert _payment(db, session_id).status == PaymentStatus.CREATED  # refresh never cancels


def test_refresh_then_webhook_has_one_effect(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str]
) -> None:
    user, ticket, session_id = checkout
    provider.mark_paid(session_id)
    payment_service.refresh_payment(db, provider, user, ticket.id)

    payload, headers = provider.build_webhook("payment.succeeded", session_id)
    late_webhook = payment_service.handle_webhook(db, provider, payload, headers)

    assert late_webhook is None  # nothing activated a second time → no second email
    assert _payment(db, session_id).provider_event_id == f"reconcile:{session_id}"


def test_webhook_then_refresh_does_not_call_provider(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str]
) -> None:
    user, ticket, session_id = checkout
    payload, headers = provider.build_webhook("payment.succeeded", session_id)
    payment_service.handle_webhook(db, provider, payload, headers)
    spy = MagicMock(wraps=provider.get_session_status)
    provider.get_session_status = spy  # type: ignore[method-assign]

    status, activated = payment_service.refresh_payment(db, provider, user, ticket.id)

    assert (status, activated) == (TicketStatus.VALID, None)
    spy.assert_not_called()


def test_newer_paid_checkout_found_among_several(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str]
) -> None:
    user, ticket, first_session = checkout
    second_session = payment_service.start_checkout(db, provider, user, ticket.id).session_id
    provider.mark_paid(second_session)

    status, _ = payment_service.refresh_payment(db, provider, user, ticket.id)

    assert status == TicketStatus.VALID
    assert _payment(db, second_session).status == PaymentStatus.PAID
    assert _payment(db, first_session).status == PaymentStatus.CREATED


def test_other_users_ticket_not_found(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str], make_user: MakeUser
) -> None:
    _, ticket, _ = checkout

    with pytest.raises(payment_service.TicketNotFoundError):
        payment_service.refresh_payment(db, provider, make_user(), ticket.id)


def test_provider_outage_propagates(
    db: Session, provider: FakePaymentProvider, checkout: tuple[User, Ticket, str]
) -> None:
    user, ticket, _ = checkout
    provider.get_session_status = MagicMock(side_effect=PaymentProviderError("down"))  # type: ignore[method-assign]

    with pytest.raises(PaymentProviderError):
        payment_service.refresh_payment(db, provider, user, ticket.id)
