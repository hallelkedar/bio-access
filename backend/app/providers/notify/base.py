from abc import ABC, abstractmethod


class Notifier(ABC):
    name: str

    @abstractmethod
    def send_email(self, *, to: str, subject: str, body: str) -> None:
        """Send a plain-text email. Raises on delivery failure."""

    @abstractmethod
    def send_sms(self, *, to: str, body: str) -> None:
        """Send a short text message. Raises on delivery failure."""
