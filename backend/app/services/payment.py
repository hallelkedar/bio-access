from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.providers.payment.base import CheckoutSession, PaymentProvider, WebhookEventType
from app.repositories import payment_repository, ticket_repository


class TicketNotFoundError(Exception):
    pass


class TicketNotPayableError(Exception):
    pass


def start_checkout(
    db: Session, provider: PaymentProvider, user: User, ticket_id: int
) -> CheckoutSession:
    """Open a provider checkout page for the user's PENDING_PAYMENT ticket.

    Someone else's ticket is reported as not found, so ticket ids can't be probed.
    Every call records a new CREATED payment; the webhook later matches it by session id.
    """
    ticket = ticket_repository.get_by_id(db, ticket_id)
    if ticket is None or ticket.user_id != user.id:
        raise TicketNotFoundError(ticket_id)
    if ticket.status != TicketStatus.PENDING_PAYMENT:
        raise TicketNotPayableError(ticket_id)

    event = ticket.event
    frontend_url = get_settings().frontend_url.rstrip("/")
    session = provider.create_checkout(
        ticket_id=ticket.id,
        amount_cents=event.price_cents,
        currency=event.currency,
        description=f"Ticket: {event.name}",
        success_url=f"{frontend_url}/checkout/success?ticket_id={ticket.id}",
        cancel_url=f"{frontend_url}/checkout/cancel?ticket_id={ticket.id}",
    )
    try:
        payment_repository.create(
            db,
            Payment(
                ticket_id=ticket.id,
                provider=provider.name,
                provider_session_id=session.session_id,
                amount_cents=event.price_cents,
                currency=event.currency,
                status=PaymentStatus.CREATED,
            ),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return session


def handle_webhook(
    db: Session, provider: PaymentProvider, payload: bytes, headers: Mapping[str, str]
) -> None:
    """Apply a signed provider webhook to the payment and its ticket.

    Raises InvalidWebhookError (from the provider) for a bad signature.
    Idempotent: a payment that already has a final status is never changed again,
    so a replayed or duplicated webhook has no effect.
    """
    event = provider.parse_webhook(payload, headers)
    if event is None:
        return

    try:
        payment = payment_repository.get_by_session_id_for_update(db, event.session_id)
        if payment is None or payment.status != PaymentStatus.CREATED:
            db.rollback()  # unknown session or already handled: nothing to do
            return

        ticket = ticket_repository.get_by_id_for_update(db, payment.ticket_id)
        if ticket is None:  # impossible while the FK exists
            raise RuntimeError(f"payment {payment.id} has no ticket")
        payment.provider_event_id = event.event_id

        if event.type == WebhookEventType.PAYMENT_SUCCEEDED:
            payment.status = PaymentStatus.PAID
            if ticket.status == TicketStatus.PENDING_PAYMENT:
                ticket.status = TicketStatus.VALID
        else:
            payment.status = PaymentStatus.FAILED
            # An old expired checkout must not cancel a ticket that a newer checkout may still pay.
            if ticket.status == TicketStatus.PENDING_PAYMENT and not payment_repository.has_open_payment(
                db, ticket.id, exclude_payment_id=payment.id
            ):
                ticket.status = TicketStatus.CANCELLED
        db.commit()
    except Exception:
        db.rollback()
        raise
