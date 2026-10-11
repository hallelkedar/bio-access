from collections.abc import Sequence

from app.providers.notify.base import Attachment, Notifier


class RecordingNotifier(Notifier):
    """Keeps sent messages in memory so tests can inspect them."""

    def __init__(self, fail_email: bool = False) -> None:
        self.fail_email = fail_email
        self.emails: list[dict[str, object]] = []
        self.sms: list[dict[str, str]] = []

    def send_email(
        self, *, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
    ) -> None:
        if self.fail_email:
            raise ConnectionError("provider down")
        self.emails.append({"to": to, "subject": subject, "body": body, "attachments": list(attachments)})

    def send_sms(self, *, to: str, body: str) -> None:
        self.sms.append({"to": to, "body": body})
