"""Offline tests: no network, no Stripe account. Webhooks are signed with Stripe's real scheme."""

import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.providers.payment.base import InvalidWebhookError, WebhookEventType
from app.providers.payment.stripe_provider import StripePaymentProvider

WEBHOOK_SECRET = "whsec_test_secret"


def _provider() -> StripePaymentProvider:
    return StripePaymentProvider("sk_test_dummy", WEBHOOK_SECRET)


def _signed(event_type: str, session: dict[str, Any], secret: str = WEBHOOK_SECRET) -> tuple[bytes, dict[str, str]]:
    body = {
        "id": "evt_test_1",
        "object": "event",
        "type": event_type,
        "data": {"object": {"object": "checkout.session", **session}},
    }
    payload = json.dumps(body).encode("utf-8")
    timestamp = int(time.time())
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return payload, {"Stripe-Signature": f"t={timestamp},v1={digest}"}


def test_create_checkout_sends_ticket_details() -> None:
    provider = _provider()
    create = MagicMock(return_value=SimpleNamespace(id="cs_test_1", url="https://checkout.stripe.com/c/cs_test_1"))
    provider._client = MagicMock()
    provider._client.v1.checkout.sessions.create = create

    session = provider.create_checkout(
        ticket_id=7,
        amount_cents=5000,
        currency="ILS",
        description="Ticket: Test Concert",
        success_url="https://app/success",
        cancel_url="https://app/cancel",
    )

    assert session.session_id == "cs_test_1"
    assert session.url == "https://checkout.stripe.com/c/cs_test_1"
    params = create.call_args.kwargs["params"]
    assert params["mode"] == "payment"
    assert params["client_reference_id"] == "7"
    assert params["line_items"][0]["price_data"] == {
        "currency": "ils",
        "unit_amount": 5000,
        "product_data": {"name": "Ticket: Test Concert"},
    }
    assert params["success_url"] == "https://app/success"
    assert params["cancel_url"] == "https://app/cancel"


def test_paid_session_completed_is_success() -> None:
    payload, headers = _signed("checkout.session.completed", {"id": "cs_1", "payment_status": "paid"})

    event = _provider().parse_webhook(payload, headers)

    assert event is not None
    assert event.event_id == "evt_test_1"
    assert event.type == WebhookEventType.PAYMENT_SUCCEEDED
    assert event.session_id == "cs_1"


def test_unpaid_session_completed_is_ignored() -> None:
    payload, headers = _signed("checkout.session.completed", {"id": "cs_1", "payment_status": "unpaid"})

    assert _provider().parse_webhook(payload, headers) is None


@pytest.mark.parametrize("event_type", ["checkout.session.expired", "checkout.session.async_payment_failed"])
def test_expired_or_failed_is_failure(event_type: str) -> None:
    payload, headers = _signed(event_type, {"id": "cs_1", "payment_status": "unpaid"})

    event = _provider().parse_webhook(payload, headers)

    assert event is not None
    assert event.type == WebhookEventType.PAYMENT_FAILED


def test_unhandled_event_type_is_ignored() -> None:
    payload, headers = _signed("customer.created", {"id": "cus_1"})

    assert _provider().parse_webhook(payload, headers) is None


def test_bad_signature_rejected() -> None:
    payload, headers = _signed("checkout.session.completed", {"id": "cs_1"}, secret="whsec_wrong")

    with pytest.raises(InvalidWebhookError):
        _provider().parse_webhook(payload, headers)


def test_missing_signature_rejected() -> None:
    payload, _ = _signed("checkout.session.completed", {"id": "cs_1"})

    with pytest.raises(InvalidWebhookError):
        _provider().parse_webhook(payload, {})


def test_missing_webhook_secret_rejected() -> None:
    payload, headers = _signed("checkout.session.completed", {"id": "cs_1"})

    with pytest.raises(InvalidWebhookError):
        StripePaymentProvider("sk_test_dummy").parse_webhook(payload, headers)


@pytest.mark.parametrize(
    ("payment_status", "status", "expected"),
    [("paid", "complete", "PAID"), ("unpaid", "open", "OPEN"), ("unpaid", "expired", "EXPIRED")],
)
def test_session_status_mapping(payment_status: str, status: str, expected: str) -> None:
    provider = _provider()
    provider._client = MagicMock()
    provider._client.v1.checkout.sessions.retrieve.return_value = SimpleNamespace(
        payment_status=payment_status, status=status
    )

    assert provider.get_session_status("cs_1").value == expected


def test_session_status_stripe_error() -> None:
    import stripe

    from app.providers.payment.base import PaymentProviderError

    provider = _provider()
    provider._client = MagicMock()
    provider._client.v1.checkout.sessions.retrieve.side_effect = stripe.APIConnectionError("no network")

    with pytest.raises(PaymentProviderError, match="APIConnectionError"):
        provider.get_session_status("cs_1")
