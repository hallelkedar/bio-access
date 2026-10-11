import logging

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.repositories import setting_repository

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
