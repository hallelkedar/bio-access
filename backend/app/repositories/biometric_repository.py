from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile


def get_by_ticket_id(db: Session, ticket_id: int) -> BiometricProfile | None:
    return db.scalars(select(BiometricProfile).where(BiometricProfile.ticket_id == ticket_id)).first()


def create(db: Session, profile: BiometricProfile) -> BiometricProfile:
    db.add(profile)
    db.flush()
    return profile
