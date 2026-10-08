from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.repositories import user_repository
from app.schemas.user import UserCreate


class EmailAlreadyRegisteredError(Exception):
    pass


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
