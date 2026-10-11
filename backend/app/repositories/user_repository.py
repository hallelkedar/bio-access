from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.schemas.admin import UserFilters


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


def get_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def _escape_like(text: str) -> str:
    """Make % and _ match literally inside a LIKE pattern."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search(db: Session, filters: UserFilters) -> tuple[list[User], int]:
    """Users matching role and a case-insensitive email/name substring, newest first; plus the total."""
    conditions = []
    if filters.role is not None:
        conditions.append(User.role == filters.role)
    if filters.q is not None:
        pattern = f"%{_escape_like(filters.q)}%"
        conditions.append(or_(User.email.ilike(pattern, escape="\\"), User.full_name.ilike(pattern, escape="\\")))

    total = db.scalar(select(func.count()).select_from(User).where(*conditions)) or 0
    query = (
        select(User)
        .where(*conditions)
        .order_by(User.created_at.desc(), User.id.desc())
        .limit(filters.limit)
        .offset(filters.offset)
    )
    return list(db.scalars(query)), total
