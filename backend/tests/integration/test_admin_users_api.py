from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.models.event import Event, EventStatus
from app.models.user import User, UserRole

MakeUser = Callable[..., User]
Headers = Callable[[User], dict[str, str]]
URL = "/api/admin/users"


def test_admin_lists_users_without_password_hashes(
    client: TestClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    keeper = make_user(UserRole.GATEKEEPER)

    response = client.get(URL, params={"role": "GATEKEEPER", "q": keeper.email}, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["email"] == keeper.email
    assert set(body["items"][0]) == {"id", "email", "full_name", "phone", "role", "created_at"}
    assert "password" not in response.text


@pytest.mark.parametrize("params", [{"role": "SUPERUSER"}, {"limit": 500}, {"q": ""}, {"q": "x" * 101}])
def test_invalid_params_return_422(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, params: dict[str, object]
) -> None:
    assert client.get(URL, params=params, headers=auth_headers(make_user(UserRole.ADMIN))).status_code == 422


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_only_admins(client: TestClient, make_user: MakeUser, auth_headers: Headers, role: UserRole) -> None:
    assert client.get(URL, headers=auth_headers(make_user(role))).status_code == 403


def test_admin_events_lists_drafts(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, make_event: Callable[..., Event]
) -> None:
    draft = make_event(EventStatus.DRAFT)

    response = client.get("/api/admin/events", headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 200
    assert draft.id in [event["id"] for event in response.json()]
    assert client.get("/api/admin/events", headers=auth_headers(make_user())).status_code == 403


def test_admin_promotes_user_and_new_role_applies_immediately(
    client: TestClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    staff = make_user(UserRole.USER)
    staff_headers = auth_headers(staff)  # token issued while still a USER
    assert client.post("/api/gate/verify-qr", json={"event_id": 1, "gate_id": "g", "qr_token": "x"}, headers=staff_headers).status_code == 403

    response = client.patch(
        f"/api/admin/users/{staff.id}/role", json={"role": "GATEKEEPER"}, headers=auth_headers(make_user(UserRole.ADMIN))
    )

    assert response.status_code == 200
    assert response.json()["role"] == "GATEKEEPER"
    # Same token, new powers: the role is read from the database on every request.
    assert client.post("/api/gate/verify-qr", json={"event_id": 1, "gate_id": "g", "qr_token": "x"}, headers=staff_headers).status_code == 404


def test_admin_cannot_change_own_role(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    admin = make_user(UserRole.ADMIN)

    response = client.patch(f"/api/admin/users/{admin.id}/role", json={"role": "USER"}, headers=auth_headers(admin))

    assert response.status_code == 409


@pytest.mark.parametrize(("body", "code"), [({"role": "SUPERUSER"}, 422), ({}, 422)])
def test_role_change_validation(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, body: dict[str, str], code: int
) -> None:
    target = make_user()

    response = client.patch(f"/api/admin/users/{target.id}/role", json=body, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == code


def test_role_change_unknown_user_and_non_admin(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    admin = auth_headers(make_user(UserRole.ADMIN))
    assert client.patch("/api/admin/users/999999/role", json={"role": "USER"}, headers=admin).status_code == 404

    target = make_user()
    gatekeeper = auth_headers(make_user(UserRole.GATEKEEPER))
    assert client.patch(f"/api/admin/users/{target.id}/role", json={"role": "ADMIN"}, headers=gatekeeper).status_code == 403
