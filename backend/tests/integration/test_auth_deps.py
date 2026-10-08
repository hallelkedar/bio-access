"""get_current_user / require_role, tested through routes that exist only in this file."""

from collections.abc import Callable, Iterator
from datetime import timedelta

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.user import User, UserRole

roles_app = FastAPI()


@roles_app.get("/any-user")
def any_user(user: User = Depends(get_current_user)) -> dict[str, int]:
    return {"id": user.id}


@roles_app.get("/admin-only")
def admin_only(user: User = Depends(require_role(UserRole.ADMIN))) -> dict[str, int]:
    return {"id": user.id}


@roles_app.get("/gate")
def gate(
    user: User = Depends(require_role(UserRole.GATEKEEPER, UserRole.ADMIN)),
) -> dict[str, int]:
    return {"id": user.id}


@pytest.fixture
def role_client(db: Session) -> Iterator[TestClient]:
    roles_app.dependency_overrides[get_db] = lambda: db
    with TestClient(roles_app) as client:
        yield client
    roles_app.dependency_overrides.clear()


MakeUser = Callable[..., User]
Headers = Callable[[User], dict[str, str]]


def test_no_token_returns_401(role_client: TestClient) -> None:
    assert role_client.get("/any-user").status_code == 401
    assert role_client.get("/admin-only").status_code == 401


def test_garbage_token_returns_401(role_client: TestClient) -> None:
    response = role_client.get("/any-user", headers={"Authorization": "Bearer not-a-jwt"})

    assert response.status_code == 401


def test_expired_token_returns_401(role_client: TestClient, make_user: MakeUser) -> None:
    user = make_user()
    token = create_access_token(user.id, user.role, expires_delta=timedelta(seconds=-1))

    response = role_client.get("/any-user", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_valid_token_returns_current_user(
    role_client: TestClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    user = make_user()

    response = role_client.get("/any-user", headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json() == {"id": user.id}


@pytest.mark.parametrize(
    ("role", "path", "expected"),
    [
        (UserRole.USER, "/admin-only", 403),
        (UserRole.GATEKEEPER, "/admin-only", 403),
        (UserRole.ADMIN, "/admin-only", 200),
        (UserRole.USER, "/gate", 403),
        (UserRole.GATEKEEPER, "/gate", 200),
        (UserRole.ADMIN, "/gate", 200),
    ],
)
def test_role_access(
    role_client: TestClient,
    make_user: MakeUser,
    auth_headers: Headers,
    role: UserRole,
    path: str,
    expected: int,
) -> None:
    user = make_user(role)

    assert role_client.get(path, headers=auth_headers(user)).status_code == expected


def test_role_is_read_from_db_not_token(role_client: TestClient, make_user: MakeUser) -> None:
    user = make_user(UserRole.USER)
    token_claiming_admin = create_access_token(user.id, UserRole.ADMIN)

    response = role_client.get(
        "/admin-only", headers={"Authorization": f"Bearer {token_claiming_admin}"}
    )

    assert response.status_code == 403
