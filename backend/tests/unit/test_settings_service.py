from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User, UserRole
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


def test_threshold_info_default(db: Session) -> None:
    info = settings_service.get_threshold_info(db)

    assert info.source == "default"
    assert info.face_match_threshold == info.default_face_match_threshold == get_settings().face_match_threshold


def test_set_threshold_then_read(db: Session, make_user: Callable[..., User], caplog: pytest.LogCaptureFixture) -> None:
    import logging

    admin = make_user(UserRole.ADMIN)
    caplog.set_level(logging.INFO)

    info = settings_service.set_face_match_threshold(db, 97.5, admin)

    assert (info.face_match_threshold, info.source) == (97.5, "database")
    assert settings_service.get_face_match_threshold(db) == 97.5
    assert f"admin {admin.id} set face_match_threshold to 97.5" in caplog.text


def test_set_threshold_overwrites(db: Session, make_user: Callable[..., User]) -> None:
    admin = make_user(UserRole.ADMIN)
    settings_service.set_face_match_threshold(db, 90, admin)

    assert settings_service.set_face_match_threshold(db, 99, admin).face_match_threshold == 99
