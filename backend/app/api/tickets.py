from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.providers.payment import get_payment_provider
from app.providers.payment.base import PaymentProvider
from app.schemas.ticket import CheckoutRead, MyTicketRead, TicketCreate, TicketRead
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
