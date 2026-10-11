from datetime import UTC, datetime

import pytest

from app.models.event import Event
from app.models.user import User
from app.providers.notify.base import Notifier
from app.services import notification as notification_service


class RecordingNotifier(Notifier):
    name = "recording"

    def __init__(self, fail_email: bool = False) -> None:
        self.fail_email = fail_email
        self.emails: list[dict[str, str]] = []
        self.sms: list[dict[str, str]] = []

    def send_email(self, *, to: str, subject: str, body: str) -> None:
        if self.fail_email:
            raise ConnectionError("provider down")
        self.emails.append({"to": to, "subject": subject, "body": body})

    def send_sms(self, *, to: str, body: str) -> None:
        self.sms.append({"to": to, "body": body})


def _user(phone: str | None) -> User:
    return User(id=1, email="dana@example.com", full_name="Dana Levi", phone=phone)


def _event() -> Event:
    return Event(name="Test Concert", location="Tel Aviv", starts_at=datetime(2026, 12, 1, 20, 0, tzinfo=UTC))


def test_sends_email_and_sms() -> None:
    notifier = RecordingNotifier()

    result = notification_service.send_ticket_confirmation(notifier, _user("+972500000000"), _event())

    assert result == notification_service.NotificationResult(email_sent=True, sms_sent=True)
    assert notifier.emails[0]["to"] == "dana@example.com"
    assert "Test Concert" in notifier.emails[0]["subject"]
    assert "01/12/2026 20:00" in notifier.emails[0]["body"]
    assert notifier.sms[0]["to"] == "+972500000000"


def test_no_phone_skips_sms() -> None:
    notifier = RecordingNotifier()

    result = notification_service.send_ticket_confirmation(notifier, _user(None), _event())

    assert result == notification_service.NotificationResult(email_sent=True, sms_sent=False)
    assert notifier.sms == []


def test_email_failure_is_logged_not_raised_and_sms_still_sent(caplog: pytest.LogCaptureFixture) -> None:
    notifier = RecordingNotifier(fail_email=True)

    result = notification_service.send_ticket_confirmation(notifier, _user("+972500000000"), _event())

    assert result == notification_service.NotificationResult(email_sent=False, sms_sent=True)
    assert "ticket confirmation email failed for user 1" in caplog.text
