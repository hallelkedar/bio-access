from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User
from app.services import analytics
from app.services import ticket as ticket_service
from app.services.event import EventNotFoundError

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]


def at(hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime(2026, 12, 1, hour, minute, second, tzinfo=UTC)


# --- bucket_entries (pure) ------------------------------------------------------


def test_floor_to_bucket() -> None:
    assert analytics.floor_to_bucket(at(18, 45)) == at(18, 30)
    assert analytics.floor_to_bucket(at(19, 0)) == at(19, 0)
    assert analytics.floor_to_bucket(at(19, 29, 59)) == at(19, 0)


def test_window_is_aligned_and_empty_buckets_are_zero() -> None:
    buckets = analytics.bucket_entries([], at(18, 45), at(20, 0))

    assert [b.bucket_start for b in buckets] == [at(18, 30), at(19, 0), at(19, 30)]
    assert [b.approved for b in buckets] == [0, 0, 0]


def test_counts_land_in_their_bucket() -> None:
    times = [at(18, 50), at(19, 5), at(19, 10), at(19, 59, 59)]

    buckets = analytics.bucket_entries(times, at(18, 45), at(20, 0))

    assert [b.approved for b in buckets] == [1, 2, 1]


def test_boundary_belongs_to_later_bucket() -> None:
    buckets = analytics.bucket_entries([at(19, 0), at(19, 30)], at(18, 30), at(20, 0))

    assert [b.approved for b in buckets] == [0, 1, 1]


def test_outside_window_ignored_and_end_excluded() -> None:
    times = [at(18, 0), at(20, 0), at(21, 0)]  # before, exactly at end, after

    buckets = analytics.bucket_entries(times, at(18, 30), at(20, 0))

    assert sum(b.approved for b in buckets) == 0


# --- event_stats ------------------------------------------------------------------


@pytest.fixture
def stats_event(db: Session, make_user: MakeUser, make_event: MakeEvent) -> Event:
    """Starts 20:00, ends 22:00, capacity 4; doors open 19:00 (default 60 min)."""
    event = make_event(EventStatus.ACTIVE, starts_at=at(20), ends_at=at(22), capacity=4)
    statuses = [TicketStatus.ENTERED, TicketStatus.ENTERED, TicketStatus.VALID, TicketStatus.CANCELLED]
    tickets = []
    for status in statuses:
        ticket = ticket_service.create_ticket(db, make_user(), event.id, now=at(10))
        ticket.status = status
        tickets.append(ticket)
    db.add_all(
        [
            AccessLog(event_id=event.id, ticket_id=tickets[0].id, gate_id="n", timestamp=at(19, 10),
                      result=AccessResult.APPROVED, reason=AccessReason.NONE, method=AccessMethod.FACE),
            AccessLog(event_id=event.id, ticket_id=tickets[1].id, gate_id="n", timestamp=at(20, 40),
                      result=AccessResult.APPROVED, reason=AccessReason.NONE, method=AccessMethod.QR),
            AccessLog(event_id=event.id, ticket_id=tickets[0].id, gate_id="s", timestamp=at(20, 45),
                      result=AccessResult.DENIED, reason=AccessReason.ALREADY_ENTERED, method=AccessMethod.FACE),
            AccessLog(event_id=event.id, ticket_id=None, gate_id="s", timestamp=at(20, 50),
                      result=AccessResult.DENIED, reason=AccessReason.NOT_RECOGNIZED, method=AccessMethod.FACE),
            AccessLog(event_id=event.id, ticket_id=None, gate_id="s", timestamp=at(20, 51),
                      result=AccessResult.DENIED, reason=AccessReason.NOT_RECOGNIZED, method=AccessMethod.FACE),
        ]
    )
    db.commit()
    return event


def test_event_stats(db: Session, stats_event: Event) -> None:
    stats = analytics.event_stats(db, stats_event.id)

    assert [b.bucket_start for b in stats.entries_per_30_min][0] == at(19)
    assert len(stats.entries_per_30_min) == 6  # 19:00 .. 21:30
    assert [b.approved for b in stats.entries_per_30_min] == [1, 0, 0, 1, 0, 0]

    decisions = stats.decisions
    assert (decisions.approved, decisions.denied) == (2, 3)
    assert decisions.denied_by_reason[AccessReason.NOT_RECOGNIZED] == 2
    assert decisions.denied_by_reason[AccessReason.ALREADY_ENTERED] == 1
    assert decisions.denied_by_reason[AccessReason.PROVIDER_ERROR] == 0  # every reason present
    assert AccessReason.NONE not in decisions.denied_by_reason
    assert decisions.approved_by_method == {AccessMethod.FACE: 1, AccessMethod.QR: 1}

    occupancy = stats.occupancy
    assert (occupancy.entered, occupancy.sold, occupancy.capacity) == (2, 3, 4)
    assert occupancy.percent == 50.0


def test_empty_event_stats(db: Session, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.ACTIVE, starts_at=at(20), ends_at=at(21), capacity=1)

    stats = analytics.event_stats(db, event.id)

    assert stats.decisions.approved == stats.decisions.denied == 0
    assert stats.decisions.approved_by_method == {AccessMethod.FACE: 0, AccessMethod.QR: 0}
    assert stats.occupancy.percent == 0.0
    assert all(b.approved == 0 for b in stats.entries_per_30_min)


def test_percent_rounding(db: Session, make_user: MakeUser, make_event: MakeEvent) -> None:
    event = make_event(EventStatus.ACTIVE, starts_at=at(20), ends_at=at(21), capacity=3)
    ticket = ticket_service.create_ticket(db, make_user(), event.id, now=at(10))
    ticket.status = TicketStatus.ENTERED
    db.commit()

    assert analytics.event_stats(db, event.id).occupancy.percent == 33.3


def test_unknown_event(db: Session) -> None:
    with pytest.raises(EventNotFoundError):
        analytics.event_stats(db, 999_999)
