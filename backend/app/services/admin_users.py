import logging

from sqlalchemy.orm import Session

from app.models.user import User, UserRole

from app.repositories import user_repository
from app.schemas.admin import UserFilters, UserPage
from app.schemas.user import UserRead

logger = logging.getLogger(__name__)


class UserNotFoundError(Exception):
    pass


class OwnRoleChangeError(Exception):
    """Admins can't change their own role (so nobody locks themselves out)."""


def list_users(db: Session, filters: UserFilters) -> UserPage:
    """One page of users for the admin table (never includes password hashes)."""
    users, total = user_repository.search(db, filters)
    return UserPage(
        items=[UserRead.model_validate(user) for user in users],
        total=total,
        limit=filters.limit,
        offset=filters.offset,
    )


def change_role(db: Session, admin: User, user_id: int, role: UserRole) -> UserRead:
    """Promote or demote a user (e.g. make a registered staff member a GATEKEEPER).

    Takes effect on the user's very next request: the role is read from the DB, not the JWT.
    """
    if user_id == admin.id:
        raise OwnRoleChangeError(user_id)
    user = user_repository.get_by_id(db, user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    previous = user.role
    if previous != role:
        user.role = role
        db.commit()
        logger.info("admin %s changed user %s role: %s -> %s", admin.id, user.id, previous.value, role.value)
    return UserRead.model_validate(user)
