from sqlalchemy.orm import Session

from app.repositories import user_repository
from app.schemas.admin import UserFilters, UserPage
from app.schemas.user import UserRead


def list_users(db: Session, filters: UserFilters) -> UserPage:
    """One page of users for the admin table (never includes password hashes)."""
    users, total = user_repository.search(db, filters)
    return UserPage(
        items=[UserRead.model_validate(user) for user in users],
        total=total,
        limit=filters.limit,
        offset=filters.offset,
    )
