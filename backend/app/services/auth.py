from functools import cache

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories import user_repository
from app.schemas.auth import LoginRequest
from app.schemas.user import UserCreate


class EmailAlreadyRegisteredError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


@cache
def _dummy_password_hash() -> str:
    return hash_password("dummy-password-for-timing")


def register(db: Session, data: UserCreate) -> User:
    if user_repository.get_by_email(db, data.email) is not None:
        raise EmailAlreadyRegisteredError(data.email)

    try:
        user = user_repository.create(
            db,
            email=data.email,
            full_name=data.full_name,
            phone=data.phone,
            password_hash=hash_password(data.password),
        )
        db.commit()
    except IntegrityError:
        # A concurrent request registered the same email after our check.
        db.rollback()
        raise EmailAlreadyRegisteredError(data.email)
    return user


def login(db: Session, data: LoginRequest) -> str:
    user = user_repository.get_by_email(db, data.email)
    if user is None:
        # Run bcrypt anyway so response time doesn't reveal whether the email exists.
        verify_password(data.password, _dummy_password_hash())
        raise InvalidCredentialsError()
    if not verify_password(data.password, user.password_hash):
        raise InvalidCredentialsError()
    return create_access_token(user.id, user.role)
