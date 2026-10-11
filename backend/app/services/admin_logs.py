from sqlalchemy.orm import Session

from app.repositories import access_log_repository
from app.schemas.admin import AccessLogFilters, AccessLogPage, AccessLogRead


class InvalidRangeError(Exception):
    pass


def list_logs(db: Session, filters: AccessLogFilters) -> AccessLogPage:
    """One page of the audit log for the admin table, newest first."""
    if filters.from_ is not None and filters.to is not None and filters.from_ >= filters.to:
        raise InvalidRangeError("'from' must be before 'to'")
    rows, total = access_log_repository.search(db, filters)
    items = [
        AccessLogRead(
            id=log.id,
            timestamp=log.timestamp,
            event_id=log.event_id,
            gate_id=log.gate_id,
            method=log.method,
            result=log.result,
            reason=log.reason,
            similarity=log.similarity,
            ticket_id=log.ticket_id,
            user_name=user_name,
        )
        for log, user_name in rows
    ]
    return AccessLogPage(items=items, total=total, limit=filters.limit, offset=filters.offset)
