from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.event import Event, EventStatus
from app.models.user import User, UserRole

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]
URL = "/api/admin/logs"


def test_admin_gets_page(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(EventStatus.ACTIVE)
    db.add(AccessLog(event_id=event.id, gate_id="north", result=AccessResult.DENIED,
                     reason=AccessReason.NOT_RECOGNIZED, method=AccessMethod.FACE))
    db.commit()

    response = client.get(
        URL, params={"event_id": event.id, "result": "DENIED", "limit": 10}, headers=auth_headers(make_user(UserRole.ADMIN))
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["limit"], body["offset"]) == (1, 10, 0)
    assert body["items"][0]["reason"] == "NOT_RECOGNIZED"
    assert body["items"][0]["user_name"] is None


@pytest.mark.parametrize(
    "params",
    [
        {"result": "MAYBE"},
        {"limit": 500},
        {"offset": -1},
        {"from": "2026-12-01T21:00:00Z", "to": "2026-12-01T20:00:00Z"},
    ],
)
def test_invalid_params_return_422(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, params: dict[str, object]
) -> None:
    assert client.get(URL, params=params, headers=auth_headers(make_user(UserRole.ADMIN))).status_code == 422


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_only_admins(client: TestClient, make_user: MakeUser, auth_headers: Headers, role: UserRole) -> None:
    assert client.get(URL, headers=auth_headers(make_user(role))).status_code == 403
