from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.schemas.admin import UserFilters
from app.services import admin_users

BASE = datetime(2026, 1, 1, tzinfo=UTC)
MakeUser = Callable[..., User]


@pytest.fixture
def people(db: Session) -> list[User]:
    users = [
        User(email="dana.levi@zebra-test.io", full_name="Dana Levi", password_hash="x",
             role=UserRole.USER, created_at=BASE),
        User(email="gate.keeper@zebra-test.io", full_name="Moshe Cohen", password_hash="x",
             role=UserRole.GATEKEEPER, created_at=BASE + timedelta(days=1)),
        User(email="a_b@zebra-test.io", full_name="Under Score", password_hash="x",
             role=UserRole.USER, created_at=BASE + timedelta(days=2)),
        User(email="axb@zebra-test.io", full_name="Not Underscore", password_hash="x",
             role=UserRole.USER, created_at=BASE + timedelta(days=3)),
    ]
    db.add_all(users)
    db.commit()
    return users


def _emails(db: Session, **filters: object) -> list[str]:
    page = admin_users.list_users(db, UserFilters(**filters))  # type: ignore[arg-type]
    return [user.email for user in page.items]


def test_search_by_email_part_newest_first(db: Session, people: list[User]) -> None:
    assert _emails(db, q="ZEBRA-TEST") == [
        "axb@zebra-test.io",
        "a_b@zebra-test.io",
        "gate.keeper@zebra-test.io",
        "dana.levi@zebra-test.io",
    ]


def test_search_by_name_any_case(db: Session, people: list[User]) -> None:
    assert _emails(db, q="moshe") == ["gate.keeper@zebra-test.io"]


def test_role_filter(db: Session, people: list[User]) -> None:
    assert _emails(db, q="zebra-test", role=UserRole.GATEKEEPER) == ["gate.keeper@zebra-test.io"]


@pytest.mark.parametrize(("q", "expected"), [("a_b@", ["a_b@zebra-test.io"]), ("100%", [])])
def test_like_wildcards_are_literal(db: Session, people: list[User], q: str, expected: list[str]) -> None:
    assert _emails(db, q=q) == expected


def test_paging_keeps_total(db: Session, people: list[User]) -> None:
    page = admin_users.list_users(db, UserFilters(q="zebra-test", limit=3, offset=3))

    assert page.total == 4
    assert [user.email for user in page.items] == ["dana.levi@zebra-test.io"]


# --- change_role -------------------------------------------------------------------


def test_promote_and_demote(db: Session, make_user: MakeUser, caplog: pytest.LogCaptureFixture) -> None:
    import logging

    admin = make_user(UserRole.ADMIN)
    staff = make_user(UserRole.USER)
    caplog.set_level(logging.INFO)

    promoted = admin_users.change_role(db, admin, staff.id, UserRole.GATEKEEPER)
    db.refresh(staff)

    assert promoted.role == staff.role == UserRole.GATEKEEPER
    assert f"admin {admin.id} changed user {staff.id} role: USER -> GATEKEEPER" in caplog.text
    assert admin_users.change_role(db, admin, staff.id, UserRole.USER).role == UserRole.USER


def test_same_role_is_a_no_op(db: Session, make_user: MakeUser, caplog: pytest.LogCaptureFixture) -> None:
    import logging

    admin = make_user(UserRole.ADMIN)
    staff = make_user(UserRole.GATEKEEPER)
    caplog.set_level(logging.INFO)

    admin_users.change_role(db, admin, staff.id, UserRole.GATEKEEPER)

    assert "changed user" not in caplog.text


def test_cannot_change_own_role(db: Session, make_user: MakeUser) -> None:
    admin = make_user(UserRole.ADMIN)

    with pytest.raises(admin_users.OwnRoleChangeError):
        admin_users.change_role(db, admin, admin.id, UserRole.USER)
    db.refresh(admin)
    assert admin.role == UserRole.ADMIN


def test_unknown_user(db: Session, make_user: MakeUser) -> None:
    with pytest.raises(admin_users.UserNotFoundError):
        admin_users.change_role(db, make_user(UserRole.ADMIN), 999_999, UserRole.GATEKEEPER)
