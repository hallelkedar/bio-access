from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.core.rate_limit import PAYMENT_REFRESH_LIMIT, limiter, user_key
from app.db.session import get_db, get_session_factory
from app.models.ticket import TicketStatus
from app.models.user import User, UserRole
from app.providers.payment import get_payment_provider
from app.providers.notify import get_notifier
from app.providers.notify.base import Notifier
from app.providers.payment.base import PaymentProvider, PaymentProviderError
from app.schemas.ticket import CheckoutRead, MyTicketRead, PaymentRefreshRead, TicketCreate, TicketRead
from app.services import notification as notification_service
from app.services import payment as payment_service
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

require_user = require_role(UserRole.USER)


@router.post("", response_model=TicketRead, status_code=status.HTTP_201_CREATED)
def create_ticket(
    data: TicketCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> TicketRead:
    try:
        ticket = ticket_service.create_ticket(db, user, data.event_id)
    except EventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    except ticket_service.EventEndedError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="event has ended")
    except ticket_service.TicketAlreadyExistsError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="you already have a ticket for this event")
    except ticket_service.SoldOutError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="event is sold out")
    return TicketRead.model_validate(ticket)


@router.get("/me", response_model=list[MyTicketRead])
def my_tickets(db: Session = Depends(get_db), user: User = Depends(require_user)) -> list[MyTicketRead]:
    return ticket_service.list_my_tickets(db, user)


@router.post("/{ticket_id}/checkout", response_model=CheckoutRead)
def checkout(
    ticket_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    provider: PaymentProvider = Depends(get_payment_provider),
) -> CheckoutRead:
    try:
        session = payment_service.start_checkout(db, provider, user, ticket_id)
    except payment_service.TicketNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    except payment_service.TicketNotPayableError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ticket is not awaiting payment")
    return CheckoutRead(checkout_url=session.url)


@router.get(
    "/{ticket_id}/qr.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
def ticket_qr(
    ticket_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)
) -> Response:
    try:
        png = ticket_service.get_my_ticket_qr(db, user, ticket_id)
    except ticket_service.TicketNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    except ticket_service.TicketNotValidError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ticket is not valid")
    # The QR is an entry credential: don't let browsers or proxies keep a copy.
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/{ticket_id}/payment/refresh", response_model=PaymentRefreshRead)
@limiter.limit(PAYMENT_REFRESH_LIMIT, key_func=user_key)
def refresh_payment(
    request: Request,
    ticket_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    provider: PaymentProvider = Depends(get_payment_provider),
    notifier: Notifier = Depends(get_notifier),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
) -> PaymentRefreshRead:
    """Back-up for a missing webhook: ask the payment provider directly whether this ticket was paid."""
    try:
        ticket_status, activated = payment_service.refresh_payment(db, provider, user, ticket_id)
    except payment_service.TicketNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    except PaymentProviderError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="payment provider unavailable")
    if activated is not None:
        background_tasks.add_task(notification_service.notify_ticket_paid, session_factory, notifier, activated)
    return PaymentRefreshRead(status=ticket_status)


@router.post("/{ticket_id}/cancel", response_model=PaymentRefreshRead)
@limiter.limit(PAYMENT_REFRESH_LIMIT, key_func=user_key)
def cancel_ticket(
    request: Request,
    ticket_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    provider: PaymentProvider = Depends(get_payment_provider),
    notifier: Notifier = Depends(get_notifier),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
) -> PaymentRefreshRead:
    """Cancel a ticket that is still awaiting payment; its open checkout pages stop working."""
    try:
        payment_service.cancel_pending_ticket(db, provider, user, ticket_id)
    except payment_service.TicketNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    except payment_service.TicketNotCancellableError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="only a ticket awaiting payment can be cancelled")
    except payment_service.TicketAlreadyPaidError as paid:
        if paid.activated is not None:
            background_tasks.add_task(notification_service.notify_ticket_paid, session_factory, notifier, paid.activated)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ticket already paid")
    except payment_service.PaymentInProgressError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="a payment is being processed, try again")
    except PaymentProviderError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="payment provider unavailable")
    return PaymentRefreshRead(status=TicketStatus.CANCELLED)

