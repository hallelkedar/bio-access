from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User, UserRole


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == email)).first()


def create(
    db: Session,
    *,
    email: str,
    full_name: str,
    phone: str | None,
    password_hash: str,
    role: UserRole = UserRole.USER,
) -> User:
    user = User(
        email=email,
        full_name=full_name,
        phone=phone,
        password_hash=password_hash,
        role=role,
    )
    db.add(user)
    db.flush()
    return user
