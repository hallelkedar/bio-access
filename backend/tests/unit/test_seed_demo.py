from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.setting import Setting
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face.base import CollectionNotFoundError
from app.providers.face.fake import FakeFaceProvider
from app.services import ticket as ticket_service
from app.services.access_control import event_open_for_entry
from scripts import seed_demo
from scripts.demo_covers import GENERIC, cover_for
from tests.events import live_window

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
DAY = date(2026, 10, 14)


def _local(hour: int, minute: int = 0) -> datetime:
    return datetime(DAY.year, DAY.month, DAY.day, hour, minute, tzinfo=seed_demo.LOCAL_TZ)


@pytest.fixture
def faces() -> FakeFaceProvider:
    return FakeFaceProvider()


def test_wipes_old_data_and_their_face_collections(
    db: Session, faces: FakeFaceProvider, make_user: MakeUser, make_event: MakeEvent
) -> None:
    old = make_event(EventStatus.ACTIVE, **live_window())
    old_id = old.id
    faces.ensure_collection(old_id)
    old_ticket_id = ticket_service.create_ticket(db, make_user(), old_id).id
    db.add(Setting(key="face_match_threshold", value="97"))
    db.commit()

    seed_demo.seed(db, faces, DAY)

    assert db.get(Event, old_id) is None
    with pytest.raises(CollectionNotFoundError):
        faces.search(old_id, b"any frame", threshold=95)
    assert db.get(Ticket, old_ticket_id) is None
    assert db.get(Setting, "face_match_threshold") is not None  # settings survive


def test_three_accounts_per_role_with_the_demo_password(db: Session, faces: FakeFaceProvider, make_user: MakeUser) -> None:
    make_user(UserRole.ADMIN, email="old.admin@example.com")

    seed_demo.seed(db, faces, DAY)

    users = {u.email: u for u in db.scalars(select(User))}
    assert "old.admin@example.com" not in users
    for role, name, email in seed_demo.USERS:
        assert (users[email].role, users[email].full_name) == (role, name)
        assert verify_password(seed_demo.DEMO_PASSWORD, users[email].password_hash)
    staff = [u for u in users.values() if u.role != UserRole.USER]
    assert len(staff) == 6  # the sample attendees are all visitors
    assert len(users) == len(seed_demo.USERS) + seed_demo.ATTENDEES


def test_three_gates_open_all_presentation_morning(db: Session, faces: FakeFaceProvider) -> None:
    seed_demo.seed(db, faces, DAY)

    events = list(db.scalars(select(Event)))
    for hour in (8, 10, 12):
        now = _local(hour).astimezone(UTC)
        assert sum(event_open_for_entry(e, now, early_minutes=60) for e in events) == 3, hour
    active = [e for e in events if e.status == EventStatus.ACTIVE]
    assert all(e.face_collection_id and faces.face_count(e.id) == 0 for e in active)  # collections exist
    closed = [e for e in events if e.status == EventStatus.CLOSED]
    assert len(closed) == 2 and all(e.ends_at < _local(0).astimezone(UTC) for e in closed)  # over before the day


def test_upcoming_events_are_on_sale(db: Session, faces: FakeFaceProvider) -> None:
    seed_demo.seed(db, faces, DAY)

    later = [e for e in db.scalars(select(Event)) if e.starts_at > _local(23, 59) + timedelta(minutes=1)]
    assert len(later) == 2 and all(e.status == EventStatus.ACTIVE for e in later)


def test_every_event_gets_its_own_cover_art() -> None:
    assert all(cover_for(spec.name) != GENERIC for spec in seed_demo.EVENTS)


def test_refuses_without_yes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.argv", ["seed_demo"])

    with pytest.raises(SystemExit, match="--yes"):
        seed_demo.main()


def test_closed_events_have_consistent_history(db: Session, faces: FakeFaceProvider) -> None:
    seed_demo.seed(db, faces, DAY)

    for event in db.scalars(select(Event).where(Event.status == EventStatus.CLOSED)):
        spec = next(e for e in seed_demo.EVENTS if e.name == event.name)
        assert spec.history is not None
        tickets = list(db.scalars(select(Ticket).where(Ticket.event_id == event.id)))
        entered = [t for t in tickets if t.status == TicketStatus.ENTERED]
        assert len(entered) == spec.history.sold - spec.history.no_shows
        assert sum(t.status == TicketStatus.CANCELLED for t in tickets) == 1
        assert len(tickets) <= event.capacity + 1  # the cancelled seat was released

        logs = list(db.scalars(select(AccessLog).where(AccessLog.event_id == event.id)))
        approved = [log for log in logs if log.result == AccessResult.APPROVED]
        # One approval per entered ticket, at the moment it entered: dashboard and tickets agree.
        assert sorted((log.ticket_id, log.timestamp) for log in approved) == sorted((t.id, t.entered_at) for t in entered)
        doors_open = event.starts_at - timedelta(hours=1)
        assert all(doors_open <= log.timestamp < event.ends_at for log in approved)
        assert {log.method for log in approved} == {AccessMethod.FACE, AccessMethod.QR}
        reasons = {log.reason for log in logs if log.result == AccessResult.DENIED}
        assert {AccessReason.NOT_RECOGNIZED, AccessReason.LOW_QUALITY, AccessReason.EVENT_NOT_ACTIVE,
                AccessReason.CANCELLED} <= reasons
        assert all(log.similarity is None for log in logs)  # never went through a face provider
        paid = db.scalar(select(func.count(Payment.id)).where(
            Payment.ticket_id.in_([t.id for t in tickets]), Payment.status == PaymentStatus.PAID))
        assert paid == spec.history.sold


def test_no_face_references_without_real_faces(db: Session, faces: FakeFaceProvider) -> None:
    seed_demo.seed(db, faces, DAY)

    assert db.scalar(select(func.count(BiometricProfile.id))) == 0


def test_history_is_the_same_on_every_run(db: Session, faces: FakeFaceProvider) -> None:
    def snapshot() -> list[tuple[str, str, str]]:
        rows = db.execute(select(Event.name, AccessLog.reason, AccessLog.timestamp).join(Event))
        return sorted((name, reason.value, ts.isoformat()) for name, reason, ts in rows)

    seed_demo.seed(db, faces, DAY)
    first = snapshot()
    seed_demo.seed(db, faces, DAY)

    assert snapshot() == first
