import enum
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class CheckoutSession:
    session_id: str
    url: str


class WebhookEventType(str, enum.Enum):
    PAYMENT_SUCCEEDED = "PAYMENT_SUCCEEDED"
    PAYMENT_FAILED = "PAYMENT_FAILED"


@dataclass(frozen=True)
class WebhookEvent:
    """Provider-independent view of a payment webhook."""

    event_id: str
    type: WebhookEventType
    session_id: str


class SessionStatus(str, enum.Enum):
    PAID = "PAID"
    OPEN = "OPEN"  # not paid (yet)
    EXPIRED = "EXPIRED"


class PaymentProviderError(Exception):
    """The provider couldn't be reached or refused the request."""


class InvalidWebhookError(Exception):
    """Bad signature or malformed payload."""


class PaymentProvider(ABC):
    name: str

    @abstractmethod
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
        """Create a hosted checkout page the user is redirected to."""

    @abstractmethod
    def parse_webhook(self, payload: bytes, headers: Mapping[str, str]) -> WebhookEvent | None:
        """Verify the signature and normalize the event.

        Returns None for event types we don't handle.
        Raises InvalidWebhookError if the signature or payload is invalid.
        """

    @abstractmethod
    def get_session_status(self, session_id: str) -> SessionStatus:
        """Ask the provider directly whether a checkout was paid (when a webhook went missing).

        Raises PaymentProviderError if the provider can't answer.
        """
