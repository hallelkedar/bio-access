from collections.abc import Callable

from fastapi.testclient import TestClient

from app.models.event import Event, EventStatus
from app.models.user import User

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


def _buy(client: TestClient, event: Event, headers: dict[str, str]) -> int:
    response = client.post("/api/tickets", json={"event_id": event.id}, headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


def test_checkout_returns_fake_url(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _buy(client, make_event(EventStatus.ACTIVE), headers)

    response = client.post(f"/api/tickets/{ticket_id}/checkout", headers=headers)

    assert response.status_code == 200
    assert response.json()["checkout_url"].startswith("https://fake-pay.local/checkout/fake_cs_")


def test_other_users_ticket_returns_404(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    ticket_id = _buy(client, make_event(EventStatus.ACTIVE), auth_headers(make_user()))

    response = client.post(f"/api/tickets/{ticket_id}/checkout", headers=auth_headers(make_user()))

    assert response.status_code == 404


def test_requires_login(client: TestClient) -> None:
    assert client.post("/api/tickets/1/checkout").status_code == 401
