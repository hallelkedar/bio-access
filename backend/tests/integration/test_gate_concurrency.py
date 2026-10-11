"""Real concurrent gate scans of one ticket (separate sessions and commits, not the rollback fixture).

Demo of what the lock prevents (not part of the suite, timing-based):
    cd backend && .venv/bin/python -m tests.integration.test_gate_concurrency
"""

import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider
from app.services import access_control
from tests.images import image_bytes

GATES = 10
FACE = image_bytes("JPEG", (32, 32))
MB = 1024 * 1024


def _user(role: UserRole) -> User:
    return User(email=f"gate-race-{uuid.uuid4().hex[:8]}@example.com", full_name="Race", password_hash="x", role=role)


def _unlocked_slow_read(db: Session, ticket_id: int) -> Ticket | None:
    """What 7.2 would be without SELECT ... FOR UPDATE, with a pause that widens the race window."""
    ticket = db.get(Ticket, ticket_id)
    time.sleep(0.05)
    return ticket


def run_gate_race(
    engine: Engine, use_lock: bool = True, mixed: bool = False
) -> tuple[Counter[str], TicketStatus, int]:
    """Scan one enrolled ticket at GATES gates at the same moment.

    mixed=True: odd gates scan the QR code instead of the face.

    Returns (decisions by reason, final ticket status, number of access-log rows).
    Everything it creates is deleted afterwards.
    """
    with Session(engine) as setup:
        admin, holder = _user(UserRole.ADMIN), _user(UserRole.USER)
        setup.add_all([admin, holder])
        setup.flush()
        starts_at = datetime.now(UTC) - timedelta(hours=1)
        event = Event(
            name="Gate race",
            location="Here",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=4),
            capacity=10,
            price_cents=0,
            currency="ILS",
            status=EventStatus.ACTIVE,
            created_by=admin.id,
        )
        setup.add(event)
        setup.flush()
        qr_token = uuid.uuid4().hex
        ticket = Ticket(event_id=event.id, user_id=holder.id, qr_token=qr_token, status=TicketStatus.VALID)
        setup.add(ticket)
        setup.commit()
        event_id, ticket_id, user_ids = event.id, ticket.id, [admin.id, holder.id]

    faces = FakeFaceProvider()
    faces.ensure_collection(event_id)
    faces.enroll(event_id, ticket_id, FACE)
    start = threading.Barrier(GATES)

    def scan(gate: int) -> str:
        with Session(engine) as session:
            start.wait()  # every gate scans at the same moment
            if mixed and gate % 2:
                decision = access_control.verify_qr(session, event_id, f"gate-{gate}", qr_token)
            else:
                decision = access_control.verify_face(session, faces, event_id, f"gate-{gate}", FACE, MB)
            return decision.reason.value if decision.result == AccessResult.DENIED else "APPROVED"

    try:
        if use_lock:
            with ThreadPoolExecutor(max_workers=GATES) as pool:
                results = Counter(pool.map(scan, range(GATES)))
        else:
            with patch("app.repositories.ticket_repository.get_by_id_for_update", _unlocked_slow_read):
                with ThreadPoolExecutor(max_workers=GATES) as pool:
                    results = Counter(pool.map(scan, range(GATES)))

        with Session(engine) as check:
            status = check.get(Ticket, ticket_id).status  # type: ignore[union-attr]
            log_count = check.scalar(select(func.count()).where(AccessLog.event_id == event_id)) or 0
        return results, status, log_count
    finally:
        with Session(engine) as cleanup:
            cleanup.execute(delete(AccessLog).where(AccessLog.event_id == event_id))
            cleanup.execute(delete(Ticket).where(Ticket.id == ticket_id))
            cleanup.execute(delete(Event).where(Event.id == event_id))
            cleanup.execute(delete(User).where(User.id.in_(user_ids)))
            cleanup.commit()


def test_parallel_scans_admit_exactly_once(engine: Engine) -> None:
    results, status, log_count = run_gate_race(engine, use_lock=True)

    assert results["APPROVED"] == 1
    assert results[AccessReason.ALREADY_ENTERED.value] == GATES - 1
    assert status == TicketStatus.ENTERED
    assert log_count == GATES  # every attempt logged


def test_parallel_face_and_qr_scans_admit_exactly_once(engine: Engine) -> None:
    results, status, log_count = run_gate_race(engine, use_lock=True, mixed=True)

    assert results["APPROVED"] == 1
    assert results[AccessReason.ALREADY_ENTERED.value] == GATES - 1
    assert status == TicketStatus.ENTERED
    assert log_count == GATES


if __name__ == "__main__":
    from sqlalchemy import create_engine, make_url

    from app.core.config import get_settings

    demo_engine = create_engine(make_url(get_settings().database_url).set(database="bioaccess_test"))
    for lock in (True, False):
        results, status, logs = run_gate_race(demo_engine, use_lock=lock)
        label = "WITH lock   " if lock else "WITHOUT lock"
        print(f"{label}: approved={results['APPROVED']}  already_entered={results['ALREADY_ENTERED']}  logs={logs}")
