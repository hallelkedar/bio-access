import hashlib
import hmac
import json
import secrets
from collections.abc import Mapping

from app.providers.payment.base import (
    CheckoutSession,
    InvalidWebhookError,
    PaymentProvider,
    PaymentProviderError,
    SessionStatus,
    WebhookEvent,
    WebhookEventType,
)

SIGNATURE_HEADER = "x-fake-signature"

_EVENT_TYPES = {
    "payment.succeeded": WebhookEventType.PAYMENT_SUCCEEDED,
    "payment.failed": WebhookEventType.PAYMENT_FAILED,
}


class FakePaymentProvider(PaymentProvider):
    """In-process provider for tests and local dev; webhooks are HMAC-SHA256 signed."""

    name = "fake"

    def __init__(
        self, webhook_secret: str = "fake-webhook-secret", base_url: str = "https://fake-pay.local"
    ) -> None:
        self._secret = webhook_secret.encode("utf-8")
        self._base_url = base_url
        self._sessions: dict[str, SessionStatus] = {}

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
        session_id = f"fake_cs_{secrets.token_hex(12)}"
        self._sessions[session_id] = SessionStatus.OPEN
        return CheckoutSession(session_id=session_id, url=f"{self._base_url}/checkout/{session_id}")

    def sign(self, payload: bytes) -> str:
        return hmac.new(self._secret, payload, hashlib.sha256).hexdigest()

    def build_webhook(
        self, event_type: str, session_id: str, event_id: str | None = None
    ) -> tuple[bytes, dict[str, str]]:
        """Simulate the provider calling our webhook (used by tests and dev tooling)."""
        body = {
            "id": event_id or f"fake_evt_{secrets.token_hex(8)}",
            "type": event_type,
            "session_id": session_id,
        }
        payload = json.dumps(body).encode("utf-8")
        return payload, {SIGNATURE_HEADER: self.sign(payload)}

    def parse_webhook(self, payload: bytes, headers: Mapping[str, str]) -> WebhookEvent | None:
        signature = {k.lower(): v for k, v in headers.items()}.get(SIGNATURE_HEADER)
        if not signature or not hmac.compare_digest(signature, self.sign(payload)):
            raise InvalidWebhookError("invalid signature")
        try:
            body = json.loads(payload)
            event_type = _EVENT_TYPES.get(body["type"])
            if event_type is None:
                return None
            return WebhookEvent(event_id=body["id"], type=event_type, session_id=body["session_id"])
        except (ValueError, KeyError, TypeError) as exc:
            raise InvalidWebhookError("malformed payload") from exc

    # --- reconciliation -----------------------------------------------------------
    def mark_paid(self, session_id: str) -> None:
        """Test control: the user paid, but (maybe) no webhook was delivered."""
        self._sessions[session_id] = SessionStatus.PAID

    def mark_expired(self, session_id: str) -> None:
        self._sessions[session_id] = SessionStatus.EXPIRED

    def get_session_status(self, session_id: str) -> SessionStatus:
        status = self._sessions.get(session_id)
        if status is None:
            raise PaymentProviderError(f"unknown session {session_id}")
        return status
