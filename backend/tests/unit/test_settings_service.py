import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.repositories import setting_repository
from app.services import settings as settings_service


def test_default_comes_from_env(db: Session) -> None:
    assert settings_service.get_face_match_threshold(db) == get_settings().face_match_threshold


def test_db_value_overrides_default(db: Session) -> None:
    setting_repository.set_value(db, "face_match_threshold", "97.5")

    assert settings_service.get_face_match_threshold(db) == 97.5


def test_set_value_updates_existing(db: Session) -> None:
    setting_repository.set_value(db, "face_match_threshold", "90")
    setting_repository.set_value(db, "face_match_threshold", "99")

    assert setting_repository.get_value(db, "face_match_threshold") == "99"


@pytest.mark.parametrize(("raw", "expected"), [("150", 100.0), ("-5", 0.0)])
def test_value_is_clamped(db: Session, raw: str, expected: float) -> None:
    setting_repository.set_value(db, "face_match_threshold", raw)

    assert settings_service.get_face_match_threshold(db) == expected


def test_garbage_value_falls_back_to_default(db: Session) -> None:
    setting_repository.set_value(db, "face_match_threshold", "high")

    assert settings_service.get_face_match_threshold(db) == get_settings().face_match_threshold
