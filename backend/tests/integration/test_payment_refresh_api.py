from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.event import Event, EventStatus
from app.models.user import User
from app.providers.payment import get_payment_provider
from app.providers.payment.fake import FakePaymentProvider
from tests.fakes import RecordingNotifier

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


@pytest.fixture
def provider(client: TestClient) -> Iterator[FakePaymentProvider]:
    """One provider instance shared by checkout and refresh, so it remembers its sessions."""
    shared = FakePaymentProvider()
    app.dependency_overrides[get_payment_provider] = lambda: shared
    yield shared


def _checkout(client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers) -> tuple[dict[str, str], int, str]:
    headers = auth_headers(make_user())
    ticket_id = client.post("/api/tickets", json={"event_id": make_event(EventStatus.ACTIVE).id}, headers=headers).json()["id"]
    url = client.post(f"/api/tickets/{ticket_id}/checkout", headers=headers).json()["checkout_url"]
    return headers, ticket_id, url.rsplit("/", 1)[-1]


def test_refresh_activates_and_emails_once(
    client: TestClient,
    provider: FakePaymentProvider,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    notifier: RecordingNotifier,
) -> None:
    headers, ticket_id, session_id = _checkout(client, make_user, make_event, auth_headers)
    url = f"/api/tickets/{ticket_id}/payment/refresh"

    assert client.post(url, headers=headers).json() == {"status": "PENDING_PAYMENT"}
    provider.mark_paid(session_id)
    assert client.post(url, headers=headers).json() == {"status": "VALID"}
    assert client.post(url, headers=headers).json() == {"status": "VALID"}

    payload, signature = provider.build_webhook("payment.succeeded", session_id)
    client.post("/webhooks/payment", content=payload, headers=signature)  # late webhook

    assert len(notifier.emails) == 1


def test_refresh_other_users_ticket_404(
    client: TestClient, provider: FakePaymentProvider, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    _, ticket_id, _ = _checkout(client, make_user, make_event, auth_headers)

    response = client.post(f"/api/tickets/{ticket_id}/payment/refresh", headers=auth_headers(make_user()))

    assert response.status_code == 404


def test_refresh_is_rate_limited(
    client: TestClient, provider: FakePaymentProvider, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers, ticket_id, _ = _checkout(client, make_user, make_event, auth_headers)

    codes = [client.post(f"/api/tickets/{ticket_id}/payment/refresh", headers=headers).status_code for _ in range(11)]

    assert codes[:10] == [200] * 10
    assert codes[10] == 429
