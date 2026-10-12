from collections.abc import Callable, Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.event import Event, EventStatus
from app.models.user import User
from app.providers.payment import get_payment_provider
from app.providers.payment.base import PaymentProviderError, SessionStatus
from app.providers.payment.fake import FakePaymentProvider

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


@pytest.fixture
def provider(client: TestClient) -> Iterator[FakePaymentProvider]:
    """One provider instance shared by checkout and cancel, so it remembers its sessions."""
    shared = FakePaymentProvider()
    app.dependency_overrides[get_payment_provider] = lambda: shared
    yield shared


def _checkout(client: TestClient, headers: dict[str, str], event_id: int) -> tuple[int, str]:
    ticket_id = client.post("/api/tickets", json={"event_id": event_id}, headers=headers).json()["id"]
    url = client.post(f"/api/tickets/{ticket_id}/checkout", headers=headers).json()["checkout_url"]
    return ticket_id, url.rsplit("/", 1)[-1]


def test_buy_cancel_buy_again(
    client: TestClient, provider: FakePaymentProvider, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    event_id = make_event(EventStatus.ACTIVE, capacity=1).id
    ticket_id, session_id = _checkout(client, headers, event_id)

    response = client.post(f"/api/tickets/{ticket_id}/cancel", headers=headers)

    assert (response.status_code, response.json()) == (200, {"status": "CANCELLED"})
    assert provider.get_session_status(session_id) == SessionStatus.EXPIRED
    [mine] = client.get("/api/tickets/me", headers=headers).json()
    assert mine["status"] == "CANCELLED"
    # The checkout page is dead: paying is refused, and the only seat can be bought again.
    assert client.post(f"/api/tickets/{ticket_id}/checkout", headers=headers).status_code == 409
    again = client.post("/api/tickets", json={"event_id": event_id}, headers=headers)
    assert (again.status_code, again.json()["status"]) == (201, "PENDING_PAYMENT")


def test_cancel_errors(
    client: TestClient, provider: FakePaymentProvider, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id, session_id = _checkout(client, headers, make_event(EventStatus.ACTIVE).id)

    assert client.post(f"/api/tickets/{ticket_id}/cancel", headers=auth_headers(make_user())).status_code == 404
    assert client.post("/api/tickets/999999/cancel", headers=headers).status_code == 404
    assert client.post(f"/api/tickets/{ticket_id}/cancel").status_code == 401

    provider.mark_paid(session_id)  # paid a moment ago, no webhook yet
    paid = client.post(f"/api/tickets/{ticket_id}/cancel", headers=headers)
    assert (paid.status_code, paid.json()["detail"]) == (409, "ticket already paid")
    [mine] = client.get("/api/tickets/me", headers=headers).json()
    assert mine["status"] == "VALID"

    again = client.post(f"/api/tickets/{ticket_id}/cancel", headers=headers)
    assert (again.status_code, again.json()["detail"]) == (409, "only a ticket awaiting payment can be cancelled")


def test_provider_down_is_503_and_keeps_the_ticket(
    client: TestClient, provider: FakePaymentProvider, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id, _ = _checkout(client, headers, make_event(EventStatus.ACTIVE).id)
    down = MagicMock(wraps=provider)
    down.expire_checkout.side_effect = PaymentProviderError("timeout")
    app.dependency_overrides[get_payment_provider] = lambda: down

    assert client.post(f"/api/tickets/{ticket_id}/cancel", headers=headers).status_code == 503
    [mine] = client.get("/api/tickets/me", headers=headers).json()
    assert mine["status"] == "PENDING_PAYMENT"
