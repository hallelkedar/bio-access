from app.providers.notify.base import Notifier


class ConsoleNotifier(Notifier):
    """Dev/test notifier: prints messages to the terminal instead of sending them."""

    name = "console"

    def send_email(self, *, to: str, subject: str, body: str) -> None:
        print(f"[EMAIL] to={to} subject={subject!r}\n{body}", flush=True)

    def send_sms(self, *, to: str, body: str) -> None:
        print(f"[SMS] to={to}\n{body}", flush=True)
