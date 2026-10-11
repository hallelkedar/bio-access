from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Attachment:
    filename: str
    content: bytes
    content_type: str


class NotificationError(Exception):
    """Delivery failed. The message never contains keys or message content."""


class EmailSender(ABC):
    @abstractmethod
    def send_email(
        self, *, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
    ) -> None:
        """Send a plain-text email. Raises NotificationError on delivery failure."""


class SmsSender(ABC):
    @abstractmethod
    def send_sms(self, *, to: str, body: str) -> None:
        """Send a short text message. Raises NotificationError on delivery failure."""


class Notifier(EmailSender, SmsSender):
    """Both channels; what the services depend on."""


class CompositeNotifier(Notifier):
    """Combines independently chosen email and SMS providers (EMAIL_PROVIDER / SMS_PROVIDER)."""

    def __init__(self, email: EmailSender, sms: SmsSender) -> None:
        self.email = email
        self.sms = sms

    def send_email(
        self, *, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
    ) -> None:
        self.email.send_email(to=to, subject=subject, body=body, attachments=attachments)

    def send_sms(self, *, to: str, body: str) -> None:
        self.sms.send_sms(to=to, body=body)
