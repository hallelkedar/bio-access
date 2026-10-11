import json

import pytest

from app.providers.payment.base import CheckoutSession, InvalidWebhookError, WebhookEventType
from app.providers.payment.fake import SIGNATURE_HEADER, FakePaymentProvider


@pytest.fixture
def provider() -> FakePaymentProvider:
    return FakePaymentProvider(webhook_secret="test-secret")


def checkout(provider: FakePaymentProvider) -> CheckoutSession:
    return provider.create_checkout(
        ticket_id=1,
        amount_cents=5000,
        currency="ILS",
        description="Concert",
        success_url="https://localhost:5173/ok",
        cancel_url="https://localhost:5173/cancel",
    )


def test_checkout_returns_unique_session_and_url(provider: FakePaymentProvider) -> None:
    first, second = checkout(provider), checkout(provider)

    assert first.session_id != second.session_id
    assert first.session_id in first.url


def test_signed_success_webhook_is_parsed(provider: FakePaymentProvider) -> None:
    payload, headers = provider.build_webhook("payment.succeeded", "cs_1", event_id="evt_1")

    event = provider.parse_webhook(payload, headers)

    assert event is not None
    assert event.event_id == "evt_1"
    assert event.type == WebhookEventType.PAYMENT_SUCCEEDED
    assert event.session_id == "cs_1"


def test_failed_payment_webhook_is_parsed(provider: FakePaymentProvider) -> None:
    payload, headers = provider.build_webhook("payment.failed", "cs_1")

    event = provider.parse_webhook(payload, headers)

    assert event is not None
    assert event.type == WebhookEventType.PAYMENT_FAILED


def test_signature_header_is_case_insensitive(provider: FakePaymentProvider) -> None:
    payload, headers = provider.build_webhook("payment.succeeded", "cs_1")

    upper = {SIGNATURE_HEADER.upper(): headers[SIGNATURE_HEADER]}

    assert provider.parse_webhook(payload, upper) is not None


def test_missing_signature_rejected(provider: FakePaymentProvider) -> None:
    payload, _ = provider.build_webhook("payment.succeeded", "cs_1")

    with pytest.raises(InvalidWebhookError):
        provider.parse_webhook(payload, {})


def test_wrong_secret_rejected(provider: FakePaymentProvider) -> None:
    attacker = FakePaymentProvider(webhook_secret="attacker-secret")
    payload, headers = attacker.build_webhook("payment.succeeded", "cs_1")

    with pytest.raises(InvalidWebhookError):
        provider.parse_webhook(payload, headers)


def test_tampered_payload_rejected(provider: FakePaymentProvider) -> None:
    payload, headers = provider.build_webhook("payment.succeeded", "cs_1")
    tampered = payload.replace(b"cs_1", b"cs_2")

    with pytest.raises(InvalidWebhookError):
        provider.parse_webhook(tampered, headers)


def test_unknown_event_type_is_ignored(provider: FakePaymentProvider) -> None:
    payload, headers = provider.build_webhook("customer.created", "cs_1")

    assert provider.parse_webhook(payload, headers) is None


def test_malformed_payload_with_valid_signature_rejected(provider: FakePaymentProvider) -> None:
    payload = json.dumps({"type": "payment.succeeded"}).encode()  # no id / session_id

    with pytest.raises(InvalidWebhookError):
        provider.parse_webhook(payload, {SIGNATURE_HEADER: provider.sign(payload)})
