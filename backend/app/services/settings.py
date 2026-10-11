import logging

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.repositories import setting_repository
from app.schemas.admin import SettingsRead

logger = logging.getLogger(__name__)

FACE_MATCH_THRESHOLD_KEY = "face_match_threshold"


def get_face_match_threshold(db: Session) -> float:
    """Similarity % a face must reach to count as a match.

    The admin-set value in the settings table wins; otherwise FACE_MATCH_THRESHOLD
    from .env. Always clamped to 0-100.
    """
    default = get_settings().face_match_threshold
    raw = setting_repository.get_value(db, FACE_MATCH_THRESHOLD_KEY)
    try:
        value = float(raw) if raw is not None else default
    except ValueError:
        logger.warning("invalid %s in settings table, using default", FACE_MATCH_THRESHOLD_KEY)
        value = default
    return min(max(value, 0.0), 100.0)


def get_threshold_info(db: Session) -> SettingsRead:
    """Current threshold, the .env default, and where the current value comes from."""
    stored = setting_repository.get_value(db, FACE_MATCH_THRESHOLD_KEY)
    return SettingsRead(
        face_match_threshold=get_face_match_threshold(db),
        default_face_match_threshold=get_settings().face_match_threshold,
        source="database" if stored is not None else "default",
    )


def set_face_match_threshold(db: Session, value: float, admin: User) -> SettingsRead:
    """Store a new threshold; the very next face search uses it (it's read on every search)."""
    try:
        setting_repository.set_value(db, FACE_MATCH_THRESHOLD_KEY, str(value))
        db.commit()
    except Exception:
        db.rollback()
        raise
    logger.info("admin %s set %s to %s", admin.id, FACE_MATCH_THRESHOLD_KEY, value)
    return get_threshold_info(db)
