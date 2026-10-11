import logging
from collections.abc import Callable
from dataclasses import dataclass

from app.models.event import Event
from app.models.ticket import Ticket
from app.models.user import User
from app.providers.notify.base import Attachment, Notifier
from app.utils.qr import make_qr_png

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NotificationResult:
    email_sent: bool
    sms_sent: bool


def send_ticket_confirmation(
    notifier: Notifier, user: User, event: Event, ticket: Ticket
) -> NotificationResult:
    """Tell the user their ticket is paid: email (with the QR) always, SMS only if they gave a phone.

    The QR (the entry credential) goes only by email; the SMS is a plain confirmation.

    Never raises: a failing channel is logged (without the message content) and
    the other channel is still tried, so notifications can't break a purchase.
    """
    when = event.starts_at.strftime("%d/%m/%Y %H:%M")
    email_sent = _try(
        "email",
        user.id,
        lambda: notifier.send_email(
            to=user.email,
            subject=f"Your ticket for {event.name}",
            body=(
                f"Hi {user.full_name},\n\n"
                f"Your payment was received and your ticket for {event.name} is confirmed.\n"
                f"When: {when}\nWhere: {event.location}\n\n"
                "Show the attached QR code at the gate if face recognition is unavailable.\n\n"
                "See you there!\nBioAccess"
            ),
            attachments=[Attachment("ticket-qr.png", make_qr_png(ticket.qr_token), "image/png")],
        ),
    )
    sms_sent = False
    if user.phone:
        sms_sent = _try(
            "sms",
            user.id,
            lambda: notifier.send_sms(
                to=user.phone or "",
                body=f"BioAccess: your ticket for {event.name} ({when}) is confirmed.",
            ),
        )
    return NotificationResult(email_sent=email_sent, sms_sent=sms_sent)


def _try(channel: str, user_id: int, send: Callable[[], None]) -> bool:
    try:
        send()
    except Exception:
        logger.exception("ticket confirmation %s failed for user %s", channel, user_id)
        return False
    return True
