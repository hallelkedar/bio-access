from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas.admin import AccessLogFilters


def create(db: Session, log: AccessLog) -> AccessLog:
    db.add(log)
    db.flush()
    return log


def search(db: Session, filters: AccessLogFilters) -> tuple[list[tuple[AccessLog, str | None]], int]:
    """Filtered logs, newest first, with the ticket holder's name; plus the total before paging."""
    conditions = []
    if filters.event_id is not None:
        conditions.append(AccessLog.event_id == filters.event_id)
    if filters.result is not None:
        conditions.append(AccessLog.result == filters.result)
    if filters.reason is not None:
        conditions.append(AccessLog.reason == filters.reason)
    if filters.method is not None:
        conditions.append(AccessLog.method == filters.method)
    if filters.gate_id is not None:
        conditions.append(AccessLog.gate_id == filters.gate_id)
    if filters.from_ is not None:
        conditions.append(AccessLog.timestamp >= filters.from_)
    if filters.to is not None:
        conditions.append(AccessLog.timestamp < filters.to)

    total = db.scalar(select(func.count()).select_from(AccessLog).where(*conditions)) or 0
    query = (
        select(AccessLog, User.full_name)
        .outerjoin(Ticket, AccessLog.ticket_id == Ticket.id)  # denials may have no ticket
        .outerjoin(User, Ticket.user_id == User.id)
        .where(*conditions)
        .order_by(AccessLog.timestamp.desc(), AccessLog.id.desc())
        .limit(filters.limit)
        .offset(filters.offset)
    )
    rows = [(log, name) for log, name in db.execute(query).all()]
    return rows, total


def count_by_result_and_reason(db: Session, event_id: int) -> list[tuple[AccessResult, AccessReason, int]]:
    query = (
        select(AccessLog.result, AccessLog.reason, func.count())
        .where(AccessLog.event_id == event_id)
        .group_by(AccessLog.result, AccessLog.reason)
    )
    return [(result, reason, count) for result, reason, count in db.execute(query).all()]


def count_approved_by_method(db: Session, event_id: int) -> list[tuple[AccessMethod, int]]:
    query = (
        select(AccessLog.method, func.count())
        .where(AccessLog.event_id == event_id, AccessLog.result == AccessResult.APPROVED)
        .group_by(AccessLog.method)
    )
    return [(method, count) for method, count in db.execute(query).all()]


def approved_timestamps(db: Session, event_id: int) -> list[datetime]:
    query = select(AccessLog.timestamp).where(
        AccessLog.event_id == event_id, AccessLog.result == AccessResult.APPROVED
    )
    return list(db.scalars(query))
