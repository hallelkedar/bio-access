import pytest
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services import auth as auth_service


def make_user_data(email: str = "dana@example.com") -> UserCreate:
    return UserCreate(email=email, full_name="Dana Levi", password="s3cret-pass")


def test_register_creates_user_with_hashed_password(db: Session) -> None:
    user = auth_service.register(db, make_user_data())

    assert user.id is not None
    assert user.role == UserRole.USER
    assert user.password_hash != "s3cret-pass"
    assert verify_password("s3cret-pass", user.password_hash)


def test_register_duplicate_email_raises(db: Session) -> None:
    auth_service.register(db, make_user_data())

    with pytest.raises(auth_service.EmailAlreadyRegisteredError):
        auth_service.register(db, make_user_data())


def test_register_duplicate_email_is_case_insensitive(db: Session) -> None:
    auth_service.register(db, make_user_data("dana@example.com"))

    with pytest.raises(auth_service.EmailAlreadyRegisteredError):
        auth_service.register(db, make_user_data("DANA@Example.com"))
