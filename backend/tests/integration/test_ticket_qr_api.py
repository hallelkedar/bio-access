from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


def _ticket(client: TestClient, make_event: MakeEvent, headers: dict[str, str]) -> int:
    return client.post("/api/tickets", json={"event_id": make_event(EventStatus.ACTIVE).id}, headers=headers).json()["id"]


def test_owner_gets_png_for_valid_ticket(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _ticket(client, make_event, headers)
    db.get(Ticket, ticket_id).status = TicketStatus.VALID  # type: ignore[union-attr]
    db.commit()

    response = client.get(f"/api/tickets/{ticket_id}/qr.png", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"\x89PNG")


def test_unpaid_ticket_returns_409(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _ticket(client, make_event, headers)

    assert client.get(f"/api/tickets/{ticket_id}/qr.png", headers=headers).status_code == 409


def test_other_users_ticket_returns_404(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    ticket_id = _ticket(client, make_event, auth_headers(make_user()))

    assert client.get(f"/api/tickets/{ticket_id}/qr.png", headers=auth_headers(make_user())).status_code == 404
