"""Real concurrent purchases (separate sessions and commits, not the rollback fixture)."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import Ticket
from app.models.user import User, UserRole
from app.services import ticket as ticket_service

BUYERS = 5


def _make_user(role: UserRole) -> User:
    return User(
        email=f"race-{uuid.uuid4().hex[:8]}@example.com",
        full_name="Race",
        password_hash="x",
        role=role,
    )


def test_last_seat_is_sold_exactly_once(engine: Engine) -> None:
    with Session(engine) as setup:
        admin = _make_user(UserRole.ADMIN)
        buyers = [_make_user(UserRole.USER) for _ in range(BUYERS)]
        setup.add_all([admin, *buyers])
        setup.flush()
        starts_at = datetime.now(UTC) + timedelta(days=1)
        event = Event(
            name="Race",
            location="Here",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=2),
            capacity=1,
            price_cents=0,
            currency="ILS",
            status=EventStatus.ACTIVE,
            created_by=admin.id,
        )
        setup.add(event)
        setup.commit()
        event_id = event.id
        user_ids = [buyer.id for buyer in buyers]
        all_user_ids = [admin.id, *user_ids]

    start = threading.Barrier(BUYERS)

    def buy(user_id: int) -> str:
        with Session(engine) as session:
            user = session.get(User, user_id)
            assert user is not None
            start.wait()  # release all buyers at the same moment
            try:
                ticket_service.create_ticket(session, user, event_id)
                return "ok"
            except ticket_service.SoldOutError:
                return "sold_out"

    try:
        with ThreadPoolExecutor(max_workers=BUYERS) as pool:
            results = list(pool.map(buy, user_ids))

        assert results.count("ok") == 1
        assert results.count("sold_out") == BUYERS - 1
    finally:
        with Session(engine) as cleanup:
            cleanup.execute(delete(Ticket).where(Ticket.event_id == event_id))
            cleanup.execute(delete(Event).where(Event.id == event_id))
            cleanup.execute(delete(User).where(User.id.in_(all_user_ids)))
            cleanup.commit()
