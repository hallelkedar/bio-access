from collections.abc import Callable

from fastapi.testclient import TestClient

from app.models.event import Event, EventStatus
from app.models.user import User
from app.providers.payment.fake import FakePaymentProvider

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]

URL = "/webhooks/payment"


def _checkout(client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers) -> tuple[dict[str, str], str]:
    """Buy a ticket and open checkout; returns (user headers, session_id)."""
    headers = auth_headers(make_user())
    ticket_id = client.post("/api/tickets", json={"event_id": make_event(EventStatus.ACTIVE).id}, headers=headers).json()["id"]
    url = client.post(f"/api/tickets/{ticket_id}/checkout", headers=headers).json()["checkout_url"]
    return headers, url.rsplit("/", 1)[-1]


def _status(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/tickets/me", headers=headers).json()[0]["status"]


def test_paid_webhook_makes_ticket_valid_and_replay_is_harmless(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers, session_id = _checkout(client, make_user, make_event, auth_headers)
    payload, signature = FakePaymentProvider().build_webhook("payment.succeeded", session_id)

    first = client.post(URL, content=payload, headers=signature)
    replay = client.post(URL, content=payload, headers=signature)

    assert first.status_code == 200
    assert first.json() == {"received": True}
    assert replay.status_code == 200
    assert _status(client, headers) == "VALID"


def test_forged_webhook_returns_400(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers, session_id = _checkout(client, make_user, make_event, auth_headers)
    payload, _ = FakePaymentProvider().build_webhook("payment.succeeded", session_id)

    response = client.post(URL, content=payload, headers={"x-fake-signature": "forged"})

    assert response.status_code == 400
    assert _status(client, headers) == "PENDING_PAYMENT"


def test_unknown_session_returns_200(client: TestClient) -> None:
    payload, signature = FakePaymentProvider().build_webhook("payment.succeeded", "fake_cs_unknown")

    assert client.post(URL, content=payload, headers=signature).status_code == 200
