from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas.admin import AccessLogFilters, AccessLogPage
from app.services import admin_logs
from app.services import ticket as ticket_service

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
T0 = datetime(2026, 12, 1, 20, 0, tzinfo=UTC)


@pytest.fixture
def logs(db: Session, make_user: MakeUser, make_event: MakeEvent) -> tuple[Event, Event, Ticket, User]:
    """Event A: approved FACE (20:00, north), denied QR with ticket (20:10, south), anonymous denial (20:20, north).
    Event B: one approved FACE (20:05)."""
    user = make_user()
    event_a = make_event(EventStatus.ACTIVE)
    event_b = make_event(EventStatus.ACTIVE)
    ticket = ticket_service.create_ticket(db, user, event_a.id)
    rows = [
        AccessLog(event_id=event_a.id, ticket_id=ticket.id, gate_id="north", timestamp=T0,
                  result=AccessResult.APPROVED, reason=AccessReason.NONE, method=AccessMethod.FACE, similarity=99.1),
        AccessLog(event_id=event_a.id, ticket_id=ticket.id, gate_id="south", timestamp=T0 + timedelta(minutes=10),
                  result=AccessResult.DENIED, reason=AccessReason.ALREADY_ENTERED, method=AccessMethod.QR),
        AccessLog(event_id=event_a.id, ticket_id=None, gate_id="north", timestamp=T0 + timedelta(minutes=20),
                  result=AccessResult.DENIED, reason=AccessReason.NOT_RECOGNIZED, method=AccessMethod.FACE),
        AccessLog(event_id=event_b.id, ticket_id=None, gate_id="north", timestamp=T0 + timedelta(minutes=5),
                  result=AccessResult.APPROVED, reason=AccessReason.NONE, method=AccessMethod.FACE),
    ]
    db.add_all(rows)
    db.commit()
    return event_a, event_b, ticket, user


def _list(db: Session, **filters: object) -> AccessLogPage:
    return admin_logs.list_logs(db, AccessLogFilters(**filters))  # type: ignore[arg-type]


def test_event_filter_newest_first_with_names(db: Session, logs: tuple[Event, Event, Ticket, User]) -> None:
    event_a, _, ticket, user = logs

    page = _list(db, event_id=event_a.id)

    assert page.total == 3
    assert [item.timestamp for item in page.items] == [T0 + timedelta(minutes=m) for m in (20, 10, 0)]
    assert [item.user_name for item in page.items] == [None, user.full_name, user.full_name]
    assert page.items[2].ticket_id == ticket.id and page.items[2].similarity == 99.1


@pytest.mark.parametrize(
    ("filters", "expected_reasons"),
    [
        ({"result": AccessResult.DENIED}, {"ALREADY_ENTERED", "NOT_RECOGNIZED"}),
        ({"reason": AccessReason.ALREADY_ENTERED}, {"ALREADY_ENTERED"}),
        ({"method": AccessMethod.QR}, {"ALREADY_ENTERED"}),
        ({"gate_id": "north"}, {"NONE", "NOT_RECOGNIZED"}),
        ({"gate_id": "north", "result": AccessResult.DENIED}, {"NOT_RECOGNIZED"}),
    ],
)
def test_single_and_combined_filters(
    db: Session, logs: tuple[Event, Event, Ticket, User], filters: dict[str, object], expected_reasons: set[str]
) -> None:
    event_a, _, _, _ = logs

    page = _list(db, event_id=event_a.id, **filters)

    assert {item.reason.value for item in page.items} == expected_reasons


def test_time_range_from_inclusive_to_exclusive(db: Session, logs: tuple[Event, Event, Ticket, User]) -> None:
    event_a, _, _, _ = logs

    page = _list(db, event_id=event_a.id, **{"from": T0 + timedelta(minutes=10), "to": T0 + timedelta(minutes=20)})

    assert [item.reason for item in page.items] == [AccessReason.ALREADY_ENTERED]


def test_paging_keeps_total(db: Session, logs: tuple[Event, Event, Ticket, User]) -> None:
    event_a, _, _, _ = logs

    first = _list(db, event_id=event_a.id, limit=2, offset=0)
    second = _list(db, event_id=event_a.id, limit=2, offset=2)

    assert (first.total, second.total) == (3, 3)
    assert len(first.items) == 2 and len(second.items) == 1
    assert {i.id for i in first.items}.isdisjoint({i.id for i in second.items})


def test_no_filters_spans_events(db: Session, logs: tuple[Event, Event, Ticket, User]) -> None:
    event_a, event_b, _, _ = logs

    page = _list(db, limit=200)

    assert {event_a.id, event_b.id} <= {item.event_id for item in page.items}


def test_from_after_to_rejected(db: Session) -> None:
    with pytest.raises(admin_logs.InvalidRangeError):
        _list(db, **{"from": T0, "to": T0})
