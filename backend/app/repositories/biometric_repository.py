from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
from app.models.ticket import Ticket


def get_by_ticket_id(db: Session, ticket_id: int) -> BiometricProfile | None:
    return db.scalars(select(BiometricProfile).where(BiometricProfile.ticket_id == ticket_id)).first()


def get_by_ticket_id_for_update(db: Session, ticket_id: int) -> BiometricProfile | None:
    """The ticket's face reference, row-locked until the transaction ends (SELECT ... FOR UPDATE)."""
    query = select(BiometricProfile).where(BiometricProfile.ticket_id == ticket_id).with_for_update()
    return db.scalars(query.execution_options(populate_existing=True)).first()


def create(db: Session, profile: BiometricProfile) -> BiometricProfile:
    db.add(profile)
    db.flush()
    return profile


def enrolled_ticket_ids(db: Session, ticket_ids: list[int]) -> set[int]:
    """Which of these tickets already have a face enrolled (one query for all of them)."""
    if not ticket_ids:
        return set()
    query = select(BiometricProfile.ticket_id).where(BiometricProfile.ticket_id.in_(ticket_ids))
    return set(db.scalars(query))


def delete_for_event(db: Session, event_id: int) -> int:
    """Delete the face references of every ticket of the event; returns how many rows went."""
    event_tickets = select(Ticket.id).where(Ticket.event_id == event_id)
    result = db.execute(delete(BiometricProfile).where(BiometricProfile.ticket_id.in_(event_tickets)))
    return int(result.rowcount or 0)
