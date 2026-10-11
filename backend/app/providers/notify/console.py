from collections.abc import Sequence

from app.providers.notify.base import Attachment, Notifier


class ConsoleNotifier(Notifier):
    """Dev/test notifier: prints messages to the terminal instead of sending them."""

    def send_email(
        self, *, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
    ) -> None:
        files = "".join(f"\n[attachment] {a.filename} ({len(a.content)} bytes)" for a in attachments)
        print(f"[EMAIL] to={to} subject={subject!r}\n{body}{files}", flush=True)

    def send_sms(self, *, to: str, body: str) -> None:
        print(f"[SMS] to={to}\n{body}", flush=True)
