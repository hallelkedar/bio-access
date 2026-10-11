from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.services import notification as notification_service
from app.services import ticket as ticket_service
from tests.fakes import RecordingNotifier

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


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


def _paid_ticket(db: Session, user: User, event: Event, status: TicketStatus = TicketStatus.VALID) -> Ticket:
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = status
    db.commit()
    return ticket


def _factory(db: Session) -> Callable[[], Session]:
    """New sessions on the test transaction, like SessionLocal would give in production."""
    return lambda: Session(bind=db.bind, join_transaction_mode="create_savepoint")


def test_notify_ticket_paid_emails_owner_with_qr(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    user = make_user()
    ticket = _paid_ticket(db, user, make_event(EventStatus.ACTIVE, name="Big Show"))
    notifier = RecordingNotifier()

    notification_service.notify_ticket_paid(_factory(db), notifier, ticket.id)

    assert len(notifier.emails) == 1
    assert notifier.emails[0]["to"] == user.email
    assert "Big Show" in str(notifier.emails[0]["subject"])
    assert notifier.emails[0]["attachments"]


def test_notify_skips_ticket_that_is_not_valid(
    db: Session, make_user: MakeUser, make_event: MakeEvent
) -> None:
    ticket = _paid_ticket(db, make_user(), make_event(EventStatus.ACTIVE), TicketStatus.CANCELLED)
    notifier = RecordingNotifier()

    notification_service.notify_ticket_paid(_factory(db), notifier, ticket.id)

    assert notifier.emails == []


def test_notify_survives_missing_ticket(db: Session, caplog: pytest.LogCaptureFixture) -> None:
    notifier = RecordingNotifier()

    notification_service.notify_ticket_paid(_factory(db), notifier, 999_999)  # no exception

    assert notifier.emails == []
    assert "ticket 999999" in caplog.text


def test_notify_survives_database_error(caplog: pytest.LogCaptureFixture) -> None:
    def broken_factory() -> Session:
        raise ConnectionError("db down")

    notification_service.notify_ticket_paid(broken_factory, RecordingNotifier(), 1)  # no exception

    assert "paid-ticket notification failed for ticket 1" in caplog.text
