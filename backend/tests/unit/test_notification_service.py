from datetime import UTC, datetime

import pytest

from collections.abc import Sequence

from app.models.event import Event
from app.models.ticket import Ticket
from app.models.user import User
from app.providers.notify.base import Attachment, Notifier
from app.services import notification as notification_service


class RecordingNotifier(Notifier):
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


def _user(phone: str | None) -> User:
    return User(id=1, email="dana@example.com", full_name="Dana Levi", phone=phone)


def _event() -> Event:
    return Event(name="Test Concert", location="Tel Aviv", starts_at=datetime(2026, 12, 1, 20, 0, tzinfo=UTC))


def _ticket() -> Ticket:
    return Ticket(id=5, qr_token="token-abc")


def test_sends_email_and_sms() -> None:
    notifier = RecordingNotifier()

    result = notification_service.send_ticket_confirmation(notifier, _user("+972500000000"), _event(), _ticket())

    assert result == notification_service.NotificationResult(email_sent=True, sms_sent=True)
    assert notifier.emails[0]["to"] == "dana@example.com"
    assert "Test Concert" in notifier.emails[0]["subject"]
    assert "01/12/2026 20:00" in notifier.emails[0]["body"]
    assert notifier.sms[0]["to"] == "+972500000000"
    assert "token-abc" not in notifier.sms[0]["body"]


def test_email_has_qr_attachment() -> None:
    notifier = RecordingNotifier()

    notification_service.send_ticket_confirmation(notifier, _user(None), _event(), _ticket())

    attachments = notifier.emails[0]["attachments"]
    assert isinstance(attachments, list) and len(attachments) == 1
    assert attachments[0].filename == "ticket-qr.png"
    assert attachments[0].content_type == "image/png"
    assert attachments[0].content.startswith(b"\x89PNG")


def test_no_phone_skips_sms() -> None:
    notifier = RecordingNotifier()

    result = notification_service.send_ticket_confirmation(notifier, _user(None), _event(), _ticket())

    assert result == notification_service.NotificationResult(email_sent=True, sms_sent=False)
    assert notifier.sms == []


def test_email_failure_is_logged_not_raised_and_sms_still_sent(caplog: pytest.LogCaptureFixture) -> None:
    notifier = RecordingNotifier(fail_email=True)

    result = notification_service.send_ticket_confirmation(notifier, _user("+972500000000"), _event(), _ticket())

    assert result == notification_service.NotificationResult(email_sent=False, sms_sent=True)
    assert "ticket confirmation email failed for user 1" in caplog.text
