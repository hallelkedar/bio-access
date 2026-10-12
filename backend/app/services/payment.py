from collections.abc import Mapping

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.providers.payment.base import (
    CheckoutAlreadyPaidError,
    CheckoutSession,
    PaymentProvider,
    PaymentProviderError,
    SessionStatus,
    WebhookEventType,
)
from app.repositories import payment_repository, ticket_repository


class TicketNotFoundError(Exception):
    pass


class TicketNotPayableError(Exception):
    pass


class TicketNotCancellableError(Exception):
    """Only a ticket still awaiting payment can be cancelled."""


class TicketAlreadyPaidError(Exception):
    """The cancel found a paid checkout; the ticket was activated instead."""

    def __init__(self, ticket_id: int, activated: int | None) -> None:
        super().__init__(ticket_id)
        self.activated = activated  # the ticket id if THIS call activated it (notify once)


class PaymentInProgressError(Exception):
    """A payment result for this ticket is being recorded right now; try again."""


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
        # A cancel may have won the race while we talked to the provider: re-check under the
        # ticket lock (cancel holds the same lock), and close the new checkout if it lost.
        locked = ticket_repository.get_by_id_for_update(db, ticket.id)
        if locked is None or locked.status != TicketStatus.PENDING_PAYMENT:
            db.rollback()
            try:
                provider.expire_checkout(session.session_id)
            except (CheckoutAlreadyPaidError, PaymentProviderError):
                pass  # best effort: nobody has the URL yet, and it expires by itself
            raise TicketNotPayableError(ticket_id)
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
) -> int | None:
    """Apply a signed provider webhook to the payment and its ticket.

    Returns the ticket id only when this webhook turned it VALID (so the caller
    notifies exactly once); None in every other case.
    Raises InvalidWebhookError (from the provider) for a bad signature.
    Idempotent: a payment that already has a final status is never changed again,
    so a replayed or duplicated webhook has no effect.
    """
    event = provider.parse_webhook(payload, headers)
    if event is None:
        return None
    return _apply_payment_result(
        db, event.session_id, event.event_id, succeeded=event.type == WebhookEventType.PAYMENT_SUCCEEDED
    )


def refresh_payment(
    db: Session, provider: PaymentProvider, user: User, ticket_id: int
) -> tuple[TicketStatus, int | None]:
    """Ask the provider directly whether the user's ticket was paid (a webhook may be missing).

    Returns (current ticket status, ticket id if THIS call activated it, else None).
    Uses the same idempotent code as the webhook, so a webhook arriving later has no
    extra effect. Raises TicketNotFoundError, or PaymentProviderError if the provider
    can't answer.
    """
    ticket = ticket_repository.get_by_id(db, ticket_id)
    if ticket is None or ticket.user_id != user.id:
        raise TicketNotFoundError(ticket_id)
    if ticket.status != TicketStatus.PENDING_PAYMENT:
        return ticket.status, None  # already settled: don't bother the provider

    activated: int | None = None
    for payment in payment_repository.list_open_for_ticket(db, ticket_id):
        session_id = payment.provider_session_id
        if provider.get_session_status(session_id) == SessionStatus.PAID:
            activated = _apply_payment_result(db, session_id, f"reconcile:{session_id}", succeeded=True)
            break
    # Expired or unpaid sessions are left to the webhook: refresh never cancels a ticket.
    db.refresh(ticket)
    return ticket.status, activated


def cancel_pending_ticket(db: Session, provider: PaymentProvider, user: User, ticket_id: int) -> None:
    """Cancel the user's ticket that is still awaiting payment, and release its seat.

    Every open checkout is closed at the provider first, so the customer can't pay a
    cancelled ticket. The ticket row stays locked throughout, which also makes a
    concurrent start_checkout wait and then see the cancellation.

    Raises TicketNotFoundError (not the user's), TicketNotCancellableError (not awaiting
    payment), PaymentInProgressError (a webhook is recording a result right now),
    PaymentProviderError (nothing changed in the database), or TicketAlreadyPaidError
    when a checkout had already been paid: that payment is recorded and the ticket
    becomes VALID instead.
    """
    ticket = ticket_repository.get_by_id(db, ticket_id)
    if ticket is None or ticket.user_id != user.id:
        raise TicketNotFoundError(ticket_id)

    paid_session: str | None = None
    try:
        ticket = ticket_repository.get_by_id_for_update(db, ticket_id)
        if ticket is None or ticket.status != TicketStatus.PENDING_PAYMENT:
            raise TicketNotCancellableError(ticket_id)
        try:
            payments = payment_repository.lock_open_for_ticket(db, ticket_id)
        except OperationalError:
            raise PaymentInProgressError(ticket_id) from None
        for payment in payments:
            try:
                provider.expire_checkout(payment.provider_session_id)
            except CheckoutAlreadyPaidError:
                paid_session = payment.provider_session_id
                break
            payment.status = PaymentStatus.FAILED
        if paid_session is None:
            ticket.status = TicketStatus.CANCELLED  # count_reserved skips it: the seat is free
            db.commit()
            return
        db.rollback()  # keep nothing from this attempt; record the payment the normal way
    except Exception:
        db.rollback()
        raise
    activated = _apply_payment_result(db, paid_session, f"cancel:{paid_session}", succeeded=True)
    raise TicketAlreadyPaidError(ticket_id, activated)


def _apply_payment_result(db: Session, session_id: str, event_id: str, *, succeeded: bool) -> int | None:
    """Record a payment result once (shared by the webhook and refresh).

    Returns the ticket id only when this call turned the ticket VALID (so the caller
    notifies exactly once). A payment that already has a final status is never changed
    again, so duplicates (replayed webhook, webhook after refresh) have no effect.
    """
    try:
        payment = payment_repository.get_by_session_id_for_update(db, session_id)
        if payment is None or payment.status != PaymentStatus.CREATED:
            db.rollback()  # unknown session or already handled: nothing to do
            return None

        ticket = ticket_repository.get_by_id_for_update(db, payment.ticket_id)
        if ticket is None:  # impossible while the FK exists
            raise RuntimeError(f"payment {payment.id} has no ticket")
        payment.provider_event_id = event_id
        activated_ticket_id: int | None = None

        if succeeded:
            payment.status = PaymentStatus.PAID
            if ticket.status == TicketStatus.PENDING_PAYMENT:
                ticket.status = TicketStatus.VALID
                activated_ticket_id = ticket.id
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
    return activated_ticket_id
