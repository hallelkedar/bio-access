"""BUILD_PLAN 12.1: the whole journey through the real HTTP API and WebSocket.

register → buy → pay (fake) → enroll (fake) → verify at the gate → admin sees it live.
Only external services are faked (payment, face recognition, email/SMS).
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.testclient import WebSocketTestSession

from app.core.security import create_access_token
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider
from app.providers.payment.fake import FakePaymentProvider
from tests.fakes import RecordingNotifier
from tests.images import image_bytes

pytestmark = pytest.mark.e2e

MakeUser = Callable[..., User]
Headers = Callable[[User], dict[str, str]]
FACE = image_bytes("JPEG", (48, 48))
PASSWORD = "correct-horse-battery"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_live_event(client: TestClient, admin: dict[str, str], capacity: int = 100) -> int:
    """Admin creates an event starting in 30 minutes (gates already open) and activates it."""
    starts = datetime.now(UTC) + timedelta(minutes=30)
    body = {
        "name": "Graduation Party",
        "location": "Tel Aviv",
        "starts_at": starts.isoformat(),
        "ends_at": (starts + timedelta(hours=4)).isoformat(),
        "capacity": capacity,
        "price_cents": 8000,
        "currency": "ILS",
    }
    created = client.post("/api/events", json=body, headers=admin)
    assert created.status_code == 201, created.text
    event_id: int = created.json()["id"]
    activated = client.put(f"/api/events/{event_id}", json={"status": "ACTIVE"}, headers=admin)
    assert activated.json()["status"] == "ACTIVE"
    return event_id


def register_and_login(client: TestClient, email: str, phone: str | None = None) -> dict[str, str]:
    body: dict[str, Any] = {"email": email, "full_name": "Noa Visitor", "password": PASSWORD}
    if phone:
        body["phone"] = phone
    registered = client.post("/api/auth/register", json=body)
    assert registered.status_code == 201, registered.text
    login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200
    return bearer(login.json()["access_token"])


def buy_and_pay(client: TestClient, visitor: dict[str, str], event_id: int) -> int:
    ticket = client.post("/api/tickets", json={"event_id": event_id}, headers=visitor).json()
    assert ticket["status"] == "PENDING_PAYMENT"
    checkout_url = client.post(f"/api/tickets/{ticket['id']}/checkout", headers=visitor).json()["checkout_url"]
    session_id = checkout_url.rsplit("/", 1)[-1]
    payload, signature = FakePaymentProvider().build_webhook("payment.succeeded", session_id)
    assert client.post("/webhooks/payment", content=payload, headers=signature).status_code == 200
    ticket_id: int = ticket["id"]
    return ticket_id


def my_ticket(client: TestClient, visitor: dict[str, str], ticket_id: int) -> dict[str, Any]:
    return next(t for t in client.get("/api/tickets/me", headers=visitor).json() if t["id"] == ticket_id)


def open_admin_feed(client: TestClient, admin_user: User) -> Any:
    ws = client.websocket_connect("/ws/admin")
    session: WebSocketTestSession = ws.__enter__()
    session.send_json({"type": "auth", "token": create_access_token(admin_user.id, admin_user.role)})
    assert session.receive_json()["type"] == "connected"
    return ws, session


def scan_face(client: TestClient, gate: dict[str, str], event_id: int, frame: bytes = FACE) -> dict[str, Any]:
    response = client.post(
        f"/api/gate/verify?event_id={event_id}&gate_id=main-entrance",
        content=frame,
        headers={**gate, "Content-Type": "image/jpeg"},
    )
    assert response.status_code == 200
    return dict(response.json())


def scan_qr(client: TestClient, gate: dict[str, str], event_id: int, token: str) -> dict[str, Any]:
    body = {"event_id": event_id, "gate_id": "side-door", "qr_token": token}
    return dict(client.post("/api/gate/verify-qr", json=body, headers=gate).json())


def test_full_journey_register_to_admin_live_feed(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    auth_headers: Headers,
    notifier: RecordingNotifier,
    face_provider: FakeFaceProvider,
) -> None:
    admin_user = make_user(UserRole.ADMIN)
    admin = auth_headers(admin_user)
    gate = auth_headers(make_user(UserRole.GATEKEEPER))  # role set in the DB: there's no role-change API

    # 1. Admin creates and activates the event; activation creates its face collection.
    event_id = create_live_event(client, admin)
    assert face_provider.face_count(event_id) == 0  # collection exists (would raise if missing)

    # 2. A visitor registers (phone normalized to E.164) and logs in with the real password.
    visitor = register_and_login(client, "noa@example.com", phone="050-123-4567")
    assert client.get("/api/auth/me", headers=visitor).json()["phone"] == "+972501234567"

    # 3. Buy, checkout, and the provider's signed webhook marks the ticket paid.
    ticket_id = buy_and_pay(client, visitor, event_id)
    assert len(notifier.emails) == 1 and len(notifier.sms) == 1
    assert notifier.emails[0]["to"] == "noa@example.com"
    assert notifier.emails[0]["attachments"]  # the QR code
    assert notifier.sms[0]["to"] == "+972501234567"

    # 4. My tickets: VALID, QR revealed, not enrolled yet.
    ticket = my_ticket(client, visitor, ticket_id)
    assert (ticket["status"], ticket["enrolled"]) == ("VALID", False)
    assert ticket["qr_token"]
    qr = client.get(f"/api/tickets/{ticket_id}/qr.png", headers=visitor)
    assert qr.headers["content-type"] == "image/png"

    # 5. Face enrollment with consent; the photo travels as the raw body.
    enrolled = client.post(
        f"/api/enrollment?ticket_id={ticket_id}&consent=true",
        content=FACE,
        headers={**visitor, "Content-Type": "image/jpeg"},
    )
    assert enrolled.status_code == 201, enrolled.text
    assert my_ticket(client, visitor, ticket_id)["enrolled"] is True

    # 6. The admin dashboard is connected to the live feed.
    feed_ctx, feed = open_admin_feed(client, admin_user)
    try:
        # 7. At the gate: the face is recognized, the admin sees it live.
        first = scan_face(client, gate, event_id)
        assert (first["result"], first["user_name"]) == ("APPROVED", "Noa Visitor")
        live = feed.receive_json()
        assert live["type"] == "access_event"
        assert (live["payload"]["result"], live["payload"]["ticket_id"], live["payload"]["method"]) == (
            "APPROVED",
            ticket_id,
            "FACE",
        )

        # Anti-passback: the same person can't come in again, by face or by QR.
        assert scan_face(client, gate, event_id)["reason"] == "ALREADY_ENTERED"
        assert scan_qr(client, gate, event_id, ticket["qr_token"])["reason"] == "ALREADY_ENTERED"
        assert feed.receive_json()["payload"]["reason"] == "ALREADY_ENTERED"
        assert feed.receive_json()["payload"]["method"] == "QR"
    finally:
        feed_ctx.__exit__(None, None, None)

    assert my_ticket(client, visitor, ticket_id)["status"] == "ENTERED"

    # 8. Admin views agree with what happened.
    stats = client.get(f"/api/admin/stats/{event_id}", headers=admin).json()
    assert stats["occupancy"] == {"entered": 1, "sold": 1, "capacity": 100, "percent": 1.0}
    assert (stats["decisions"]["approved"], stats["decisions"]["denied"]) == (1, 2)
    assert stats["decisions"]["denied_by_reason"]["ALREADY_ENTERED"] == 2
    assert sum(bucket["approved"] for bucket in stats["entries_per_30_min"]) == 1

    logs = client.get("/api/admin/logs", params={"event_id": event_id}, headers=admin).json()
    assert logs["total"] == 3
    assert [row["result"] for row in logs["items"]] == ["DENIED", "DENIED", "APPROVED"]  # newest first
    assert {row["user_name"] for row in logs["items"]} == {"Noa Visitor"}


def test_unhappy_day_face_service_down_qr_fallback(
    client: TestClient,
    make_user: MakeUser,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    admin_user = make_user(UserRole.ADMIN)
    admin = auth_headers(admin_user)
    gate = auth_headers(make_user(UserRole.GATEKEEPER))
    event_id = create_live_event(client, admin)
    visitor = register_and_login(client, "dan@example.com")
    ticket_id = buy_and_pay(client, visitor, event_id)
    client.post(
        f"/api/enrollment?ticket_id={ticket_id}&consent=true",
        content=FACE,
        headers={**visitor, "Content-Type": "image/jpeg"},
    )
    qr_token = my_ticket(client, visitor, ticket_id)["qr_token"]

    feed_ctx, feed = open_admin_feed(client, admin_user)
    try:
        face_provider.available = False  # AWS outage at the gate

        assert scan_face(client, gate, event_id)["reason"] == "PROVIDER_ERROR"
        fallback = scan_qr(client, gate, event_id, qr_token)

        assert (fallback["result"], fallback["user_name"]) == ("APPROVED", "Noa Visitor")
        assert feed.receive_json()["payload"]["reason"] == "PROVIDER_ERROR"
        assert feed.receive_json()["payload"]["method"] == "QR"
    finally:
        feed_ctx.__exit__(None, None, None)

    stats = client.get(f"/api/admin/stats/{event_id}", headers=admin).json()
    assert stats["decisions"]["approved_by_method"] == {"FACE": 0, "QR": 1}
    assert stats["decisions"]["denied_by_reason"]["PROVIDER_ERROR"] == 1
