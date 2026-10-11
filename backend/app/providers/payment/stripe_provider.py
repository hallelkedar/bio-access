from collections.abc import Mapping

import stripe

from app.providers.payment.base import (
    CheckoutSession,
    InvalidWebhookError,
    PaymentProvider,
    PaymentProviderError,
    SessionStatus,
    WebhookEvent,
    WebhookEventType,
)

SIGNATURE_HEADER = "stripe-signature"

_FAILED_EVENTS = {"checkout.session.expired", "checkout.session.async_payment_failed"}


class StripePaymentProvider(PaymentProvider):
    """Stripe Checkout (hosted page). Use sk_test_ keys: test mode, no real money."""

    name = "stripe"

    def __init__(self, secret_key: str, webhook_secret: str | None = None) -> None:
        self._client = stripe.StripeClient(secret_key)
        self._webhook_secret = webhook_secret

    def create_checkout(
        self,
        *,
        ticket_id: int,
        amount_cents: int,
        currency: str,
        description: str,
        success_url: str,
        cancel_url: str,
    ) -> CheckoutSession:
        session = self._client.v1.checkout.sessions.create(
            params={
                "mode": "payment",
                "line_items": [
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": currency.lower(),
                            "unit_amount": amount_cents,
                            "product_data": {"name": description},
                        },
                    }
                ],
                "client_reference_id": str(ticket_id),
                "metadata": {"ticket_id": str(ticket_id)},
                "success_url": success_url,
                "cancel_url": cancel_url,
            }
        )
        if not session.url:
            raise RuntimeError("Stripe returned a checkout session without a URL")
        return CheckoutSession(session_id=session.id, url=session.url)

    def parse_webhook(self, payload: bytes, headers: Mapping[str, str]) -> WebhookEvent | None:
        if not self._webhook_secret:
            raise InvalidWebhookError("STRIPE_WEBHOOK_SECRET is not configured")
        signature = {k.lower(): v for k, v in headers.items()}.get(SIGNATURE_HEADER)
        try:
            event = self._client.construct_event(payload, signature, self._webhook_secret)
        except (stripe.SignatureVerificationError, ValueError) as exc:
            raise InvalidWebhookError("invalid signature or payload") from exc

        session = event.data.object
        if event.type == "checkout.session.completed":
            # Delayed methods (e.g. bank debits) complete as "unpaid" and succeed later.
            if session.payment_status != "paid":
                return None
            event_type = WebhookEventType.PAYMENT_SUCCEEDED
        elif event.type == "checkout.session.async_payment_succeeded":
            event_type = WebhookEventType.PAYMENT_SUCCEEDED
        elif event.type in _FAILED_EVENTS:
            event_type = WebhookEventType.PAYMENT_FAILED
        else:
            return None
        return WebhookEvent(event_id=event.id, type=event_type, session_id=session.id)

    def get_session_status(self, session_id: str) -> SessionStatus:
        try:
            session = self._client.v1.checkout.sessions.retrieve(session_id)
        except stripe.StripeError as exc:
            raise PaymentProviderError(f"stripe: {type(exc).__name__}") from None
        if session.payment_status == "paid":
            return SessionStatus.PAID
        if session.status == "expired":
            return SessionStatus.EXPIRED
        return SessionStatus.OPEN
