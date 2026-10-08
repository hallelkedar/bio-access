from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.ticket import MyTicketRead, TicketCreate, TicketRead
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
