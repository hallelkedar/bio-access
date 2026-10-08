import pytest
from sqlalchemy.orm import Session

from app.core.security import create_access_token, decode_access_token, verify_password
from app.models.user import UserRole
from app.schemas.auth import LoginRequest
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


def test_login_returns_token_for_user(db: Session) -> None:
    user = auth_service.register(db, make_user_data())

    token = auth_service.login(db, LoginRequest(email="dana@example.com", password="s3cret-pass"))

    payload = decode_access_token(token)
    assert payload.user_id == user.id
    assert payload.role == UserRole.USER


def test_login_email_is_case_insensitive(db: Session) -> None:
    auth_service.register(db, make_user_data())

    token = auth_service.login(db, LoginRequest(email="DANA@example.com", password="s3cret-pass"))

    assert token


def test_login_wrong_password_raises(db: Session) -> None:
    auth_service.register(db, make_user_data())

    with pytest.raises(auth_service.InvalidCredentialsError):
        auth_service.login(db, LoginRequest(email="dana@example.com", password="wrong-pass"))


def test_login_unknown_email_raises(db: Session) -> None:
    with pytest.raises(auth_service.InvalidCredentialsError):
        auth_service.login(db, LoginRequest(email="nobody@example.com", password="s3cret-pass"))


def test_get_user_from_token_returns_user(db: Session) -> None:
    user = auth_service.register(db, make_user_data())

    found = auth_service.get_user_from_token(db, create_access_token(user.id, user.role))

    assert found.id == user.id


def test_get_user_from_token_rejects_invalid_token(db: Session) -> None:
    with pytest.raises(auth_service.InvalidCredentialsError):
        auth_service.get_user_from_token(db, "not-a-jwt")


def test_get_user_from_token_rejects_deleted_user(db: Session) -> None:
    user = auth_service.register(db, make_user_data())
    token = create_access_token(user.id, user.role)
    db.delete(user)
    db.commit()

    with pytest.raises(auth_service.InvalidCredentialsError):
        auth_service.get_user_from_token(db, token)


def test_create_admin_creates_admin(db: Session) -> None:
    user = auth_service.create_admin(db, make_user_data("admin@example.com"))

    assert user.role == UserRole.ADMIN
    assert verify_password("s3cret-pass", user.password_hash)


def test_create_admin_duplicate_email_raises(db: Session) -> None:
    auth_service.register(db, make_user_data("admin@example.com"))

    with pytest.raises(auth_service.EmailAlreadyRegisteredError):
        auth_service.create_admin(db, make_user_data("admin@example.com"))
