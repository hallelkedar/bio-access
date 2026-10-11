from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.access_log import AccessMethod, AccessReason, AccessResult
from app.models.ticket import TicketStatus
from app.repositories import access_log_repository, ticket_repository
from app.schemas.admin import DecisionBreakdown, EntryBucket, EventStats, Occupancy
from app.services import event as event_service

BUCKET_MINUTES = 30


def floor_to_bucket(moment: datetime, minutes: int = BUCKET_MINUTES) -> datetime:
    """Round down to a bucket boundary (e.g. :00 or :30 for 30-minute buckets), in UTC."""
    width = minutes * 60
    seconds = int(moment.timestamp())
    return datetime.fromtimestamp(seconds - seconds % width, tz=UTC)


def bucket_entries(
    timestamps: Iterable[datetime], window_start: datetime, window_end: datetime, minutes: int = BUCKET_MINUTES
) -> list[EntryBucket]:
    """Count timestamps per bucket across [floor(window_start), window_end).

    Every bucket in the window is returned, empty ones as 0, so charts have no gaps.
    A timestamp exactly on a boundary belongs to the bucket that starts there.
    """
    first = floor_to_bucket(window_start, minutes)
    width = timedelta(minutes=minutes)
    starts: list[datetime] = []
    cursor = first
    while cursor < window_end:
        starts.append(cursor)
        cursor += width
    counts = [0] * len(starts)
    for moment in timestamps:
        if first <= moment < window_end:
            counts[int((moment - first) / width)] += 1
    return [EntryBucket(bucket_start=start, approved=count) for start, count in zip(starts, counts, strict=True)]


def event_stats(db: Session, event_id: int) -> EventStats:
    """Dashboard numbers for one event. Raises EventNotFoundError."""
    event = event_service.get_event(db, event_id)

    doors_open = event.starts_at - timedelta(minutes=get_settings().gate_opens_minutes_before)
    buckets = bucket_entries(access_log_repository.approved_timestamps(db, event_id), doors_open, event.ends_at)

    denied_by_reason = {reason: 0 for reason in AccessReason if reason != AccessReason.NONE}
    approved = 0
    for result, reason, count in access_log_repository.count_by_result_and_reason(db, event_id):
        if result == AccessResult.APPROVED:
            approved += count
        else:
            denied_by_reason[reason] = denied_by_reason.get(reason, 0) + count
    approved_by_method = {method: 0 for method in AccessMethod}
    approved_by_method.update(dict(access_log_repository.count_approved_by_method(db, event_id)))

    tickets = ticket_repository.count_by_status(db, event_id)
    entered = tickets.get(TicketStatus.ENTERED, 0)
    sold = entered + tickets.get(TicketStatus.VALID, 0)

    return EventStats(
        event_id=event_id,
        entries_per_30_min=buckets,
        decisions=DecisionBreakdown(
            approved=approved,
            denied=sum(denied_by_reason.values()),
            denied_by_reason=denied_by_reason,
            approved_by_method=approved_by_method,
        ),
        occupancy=Occupancy(
            entered=entered,
            sold=sold,
            capacity=event.capacity,
            percent=round(entered / event.capacity * 100, 1),  # capacity > 0 (DB check)
        ),
    )
