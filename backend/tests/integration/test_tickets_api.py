from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.models.event import Event, EventStatus
from app.models.user import User, UserRole

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]

URL = "/api/tickets"


def test_user_buys_pending_ticket(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(EventStatus.ACTIVE)

    response = client.post(URL, json={"event_id": event.id}, headers=auth_headers(make_user()))

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "PENDING_PAYMENT"
    assert body["event_id"] == event.id
    assert "qr_token" not in body


def test_duplicate_returns_409(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    event = make_event(EventStatus.ACTIVE)
    client.post(URL, json={"event_id": event.id}, headers=headers)

    response = client.post(URL, json={"event_id": event.id}, headers=headers)

    assert response.status_code == 409


def test_sold_out_returns_409(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(EventStatus.ACTIVE, capacity=1)
    client.post(URL, json={"event_id": event.id}, headers=auth_headers(make_user()))

    response = client.post(URL, json={"event_id": event.id}, headers=auth_headers(make_user()))

    assert response.status_code == 409
    assert response.json()["detail"] == "event is sold out"


def test_draft_event_returns_404(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(EventStatus.DRAFT)

    response = client.post(URL, json={"event_id": event.id}, headers=auth_headers(make_user()))

    assert response.status_code == 404


@pytest.mark.parametrize("role", [UserRole.GATEKEEPER, UserRole.ADMIN])
def test_only_users_buy_tickets(
    client: TestClient,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    role: UserRole,
) -> None:
    event = make_event(EventStatus.ACTIVE)

    response = client.post(URL, json={"event_id": event.id}, headers=auth_headers(make_user(role)))

    assert response.status_code == 403


def test_requires_login(client: TestClient) -> None:
    assert client.post(URL, json={"event_id": 1}).status_code == 401


def test_my_tickets_returns_only_own(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    me, other = make_user(), make_user()
    mine = make_event(EventStatus.ACTIVE, name="Mine")
    theirs = make_event(EventStatus.ACTIVE, name="Theirs")
    client.post(URL, json={"event_id": mine.id}, headers=auth_headers(me))
    client.post(URL, json={"event_id": theirs.id}, headers=auth_headers(other))

    response = client.get(f"{URL}/me", headers=auth_headers(me))

    assert response.status_code == 200
    [ticket] = response.json()
    assert ticket["event"]["name"] == "Mine"
    assert ticket["status"] == "PENDING_PAYMENT"
    assert ticket["qr_token"] is None


def test_my_tickets_empty(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    response = client.get(f"{URL}/me", headers=auth_headers(make_user()))

    assert response.status_code == 200
    assert response.json() == []


def test_my_tickets_requires_login(client: TestClient) -> None:
    assert client.get(f"{URL}/me").status_code == 401
