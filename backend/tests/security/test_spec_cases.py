"""PROJECT_SPEC §12: one test per security/abuse case (#1-#14).

Each test is named after its case number so the project book can cite it.
"""

import re
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import ARRAY, Engine, LargeBinary, PickleType, func, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import Base
from app.main import app
from app.models.access_log import AccessLog, AccessResult
from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider
from app.providers.payment.fake import FakePaymentProvider
from app.services import ticket as ticket_service
from tests import malicious
from tests.events import live_window
from tests.images import image_bytes
from tests.integration.test_gate_concurrency import GATES, run_gate_race

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]

FACE = image_bytes("JPEG", (32, 32))
REPO_ROOT = Path(__file__).resolve().parents[3]

# Routes anyone may call. Everything else must demand a token.
PUBLIC_ROUTES = {
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/webhooks/payment"),  # authenticated by the provider's signature instead
    ("GET", "/health"),
    ("GET", "/health/db"),
}
# Admin-only routes outside /api/admin (every /api/admin/* route is included automatically).
ADMIN_ROUTES_ELSEWHERE = {
    ("POST", "/api/events"),
    ("PUT", "/api/events/{event_id}"),
    ("DELETE", "/api/events/{event_id}"),
    ("POST", "/api/events/{event_id}/cover"),
}


def _http_routes() -> list[tuple[str, str]]:
    """Every HTTP route, from the OpenAPI schema (covers nested routers too)."""
    return [(method.upper(), path) for path, ops in app.openapi()["paths"].items() for method in ops]


def _call(client: TestClient, method: str, path: str, headers: dict[str, str] | None = None) -> Any:
    url = re.sub(r"\{[^}]+\}", "1", path)
    return client.request(method, url, json={}, headers=headers or {})


@pytest.fixture
def enrolled(
    db: Session, make_user: MakeUser, make_event: MakeEvent, face_provider: FakeFaceProvider
) -> tuple[Event, Ticket, User]:
    user = make_user()
    event = make_event(EventStatus.ACTIVE, **live_window())
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()
    face_provider.ensure_collection(event.id)
    face_provider.enroll(event.id, ticket.id, FACE)
    return event, ticket, user


def _face(client: TestClient, event_id: int, headers: dict[str, str], body: bytes = FACE) -> dict[str, Any]:
    response = client.post(
        f"/api/gate/verify?event_id={event_id}&gate_id=north-1",
        content=body,
        headers={**headers, "Content-Type": "image/jpeg"},
    )
    return dict(response.json())


def _qr(client: TestClient, event_id: int, token: str, headers: dict[str, str]) -> Any:
    return client.post(
        "/api/gate/verify-qr", json={"event_id": event_id, "gate_id": "north-1", "qr_token": token}, headers=headers
    )


# --- 1 ---------------------------------------------------------------------------


def test_case_01_rescan_of_used_ticket_denied_and_logged(
    client: TestClient, db: Session, enrolled: tuple[Event, Ticket, User], make_user: MakeUser, auth_headers: Headers
) -> None:
    event, _, _ = enrolled
    gate = auth_headers(make_user(UserRole.GATEKEEPER))

    assert _face(client, event.id, gate)["result"] == "APPROVED"
    second = _face(client, event.id, gate)

    assert (second["result"], second["reason"]) == ("DENIED", "ALREADY_ENTERED")
    results = db.scalars(select(AccessLog.result).where(AccessLog.event_id == event.id).order_by(AccessLog.id))
    assert list(results) == [AccessResult.APPROVED, AccessResult.DENIED]


# --- 2 ---------------------------------------------------------------------------


@pytest.mark.xfail(strict=True, reason="Known limitation: liveness (BUILD_PLAN 6.7) is not implemented")
def test_case_02_photo_of_enrolled_face_is_denied(
    client: TestClient, enrolled: tuple[Event, Ticket, User], make_user: MakeUser, auth_headers: Headers
) -> None:
    event, _, _ = enrolled
    replayed_photo = FACE  # a printed/phone photo looks the same as the enrolled face

    decision = _face(client, event.id, auth_headers(make_user(UserRole.GATEKEEPER)), body=replayed_photo)

    assert decision["reason"] == "LIVENESS_FAILED"


# --- 3 ---------------------------------------------------------------------------


def test_case_03_every_protected_route_requires_a_token(client: TestClient) -> None:
    routes = [route for route in _http_routes() if route not in PUBLIC_ROUTES]
    assert len(routes) >= 15  # sanity: the sweep really sees the app's routes

    not_401 = [(m, p, code) for m, p in routes if (code := _call(client, m, p).status_code) != 401]

    assert not_401 == []


def test_case_03_admin_websocket_requires_a_token(client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect("/ws/admin") as ws:
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4401


# --- 4 ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_case_04_non_admins_get_403_on_every_admin_route(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, role: UserRole
) -> None:
    admin_routes = {r for r in _http_routes() if r[1].startswith("/api/admin/")} | ADMIN_ROUTES_ELSEWHERE
    assert len(admin_routes) >= 9
    headers = auth_headers(make_user(role))

    not_403 = [(m, p, code) for m, p in sorted(admin_routes) if (code := _call(client, m, p, headers).status_code) != 403]

    assert not_403 == []


# --- 5 ---------------------------------------------------------------------------

INJECTIONS = ["' OR '1'='1", "'; DROP TABLE users; --", "\" OR 1=1 --", "admin'--"]


@pytest.mark.parametrize("payload", INJECTIONS)
def test_case_05_sql_injection_is_just_data(
    client: TestClient,
    db: Session,
    enrolled: tuple[Event, Ticket, User],
    make_user: MakeUser,
    auth_headers: Headers,
    payload: str,
) -> None:
    event, _, _ = enrolled
    admin = auth_headers(make_user(UserRole.ADMIN))

    login = client.post("/api/auth/login", json={"email": f"x{payload}@example.com", "password": payload})
    users = client.get("/api/admin/users", params={"q": payload}, headers=admin)
    logs = client.get("/api/admin/logs", params={"gate_id": payload}, headers=admin)
    qr = _qr(client, event.id, payload, auth_headers(make_user(UserRole.GATEKEEPER)))

    assert login.status_code in (401, 422)  # rejected as bad credentials / bad email, never a login
    assert (users.status_code, users.json()["total"]) == (200, 0)
    assert (logs.status_code, logs.json()["total"]) == (200, 0)
    assert qr.json()["reason"] == "NOT_RECOGNIZED"
    assert db.scalar(select(func.count()).select_from(User)) > 0  # the users table is still there


# --- 6 ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload", [malicious.svg_with_script(), malicious.html_page(), malicious.decompression_bomb_png()]
)
def test_case_06_malicious_upload_rejected(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers, payload: bytes
) -> None:
    response = client.post(
        f"/api/events/{make_event().id}/cover",
        files={"file": ("cover.png", payload, "image/png")},
        headers=auth_headers(make_user(UserRole.ADMIN)),
    )

    assert response.status_code == 415


# --- 7 ---------------------------------------------------------------------------


def test_case_07_entry_outside_event_time_denied(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(EventStatus.ACTIVE)  # starts tomorrow: gates are closed now
    ticket = ticket_service.create_ticket(db, make_user(), event.id)
    ticket.status = TicketStatus.VALID
    db.commit()

    response = _qr(client, event.id, ticket.qr_token, auth_headers(make_user(UserRole.GATEKEEPER)))

    assert (response.json()["result"], response.json()["reason"]) == ("DENIED", "EVENT_NOT_ACTIVE")


# --- 8 ---------------------------------------------------------------------------


@pytest.mark.parametrize("mixed", [False, True], ids=["face-only", "face-and-qr"])
def test_case_08_two_gates_same_ticket_exactly_one_approved(engine: Engine, mixed: bool) -> None:
    results, status, _ = run_gate_race(engine, use_lock=True, mixed=mixed)

    assert results["APPROVED"] == 1
    assert results["ALREADY_ENTERED"] == GATES - 1
    assert status == TicketStatus.ENTERED


# --- 9 ---------------------------------------------------------------------------


def test_case_09_brute_force_gets_429(client: TestClient) -> None:
    body = {"email": "victim@example.com", "password": "guess"}

    statuses = [client.post("/api/auth/login", json=body).status_code for _ in range(11)]

    assert statuses[-1] == 429


# --- 10 --------------------------------------------------------------------------


def test_case_10_schema_has_nowhere_to_store_images_or_vectors() -> None:
    risky = (LargeBinary, ARRAY, PickleType)
    offenders = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, risky)
    ]

    assert offenders == []


def test_case_10_db_holds_only_face_references_and_password_hashes(
    client: TestClient, db: Session, make_event: MakeEvent, auth_headers: Headers
) -> None:
    password = "correct-horse-battery"
    created = client.post(
        "/api/auth/register", json={"email": "leak@example.com", "full_name": "Leak Test", "password": password}
    ).json()
    user = db.get(User, created["id"])
    assert user is not None
    event = make_event(EventStatus.ACTIVE, **live_window())
    ticket = ticket_service.create_ticket(db, user, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()
    photo = image_bytes("JPEG", (48, 48))

    enrolled = client.post(
        f"/api/enrollment?ticket_id={ticket.id}&consent=true",
        content=photo,
        headers={**auth_headers(user), "Content-Type": "image/jpeg"},
    )

    assert enrolled.status_code == 201
    assert user.password_hash.startswith("$2b$") and password not in user.password_hash
    profile = db.scalars(select(BiometricProfile).where(BiometricProfile.ticket_id == ticket.id)).one()
    assert len(profile.face_id) <= 64 and profile.collection_id == f"bioaccess-event-{event.id}"
    dump = db.execute(text("SELECT row_to_json(b)::text FROM biometric_profiles b WHERE ticket_id = :t"), {"t": ticket.id})
    assert len(dump.scalar_one()) < 300  # a reference, not an image (the photo alone is far larger)


# --- 11 / 12 ---------------------------------------------------------------------


def _checkout(client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers) -> tuple[dict[str, str], str]:
    headers = auth_headers(make_user())
    ticket_id = client.post("/api/tickets", json={"event_id": make_event(EventStatus.ACTIVE).id}, headers=headers).json()["id"]
    url = client.post(f"/api/tickets/{ticket_id}/checkout", headers=headers).json()["checkout_url"]
    return headers, url.rsplit("/", 1)[-1]


def test_case_11_forged_payment_webhook_gets_400(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers, session_id = _checkout(client, make_user, make_event, auth_headers)
    payload, _ = FakePaymentProvider().build_webhook("payment.succeeded", session_id)

    response = client.post("/webhooks/payment", content=payload, headers={"x-fake-signature": "forged"})

    assert response.status_code == 400
    assert client.get("/api/tickets/me", headers=headers).json()[0]["status"] == "PENDING_PAYMENT"


def test_case_12_same_webhook_twice_has_one_effect(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers, notifier: Any
) -> None:
    headers, session_id = _checkout(client, make_user, make_event, auth_headers)
    payload, signature = FakePaymentProvider().build_webhook("payment.succeeded", session_id)

    codes = [client.post("/webhooks/payment", content=payload, headers=signature).status_code for _ in range(2)]

    assert codes == [200, 200]
    assert client.get("/api/tickets/me", headers=headers).json()[0]["status"] == "VALID"
    assert len(notifier.emails) == 1


# --- 13 --------------------------------------------------------------------------


def test_case_13_face_provider_down_then_qr_fallback_admits(
    client: TestClient,
    enrolled: tuple[Event, Ticket, User],
    make_user: MakeUser,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    event, ticket, user = enrolled
    gate = auth_headers(make_user(UserRole.GATEKEEPER))
    face_provider.available = False

    assert _face(client, event.id, gate)["reason"] == "PROVIDER_ERROR"
    fallback = _qr(client, event.id, ticket.qr_token, gate).json()

    assert (fallback["result"], fallback["user_name"]) == ("APPROVED", user.full_name)


# --- 14 --------------------------------------------------------------------------

KEY_PATTERNS = {
    "stripe live key": r"sk_live_[A-Za-z0-9]{10,}",
    "stripe test key": r"sk_test_[A-Za-z0-9]{10,}",
    "stripe webhook secret": r"whsec_[A-Za-z0-9]{10,}",
    "aws access key id": r"AKIA[0-9A-Z]{16}",
    "resend api key": r"re_[A-Za-z0-9]{20,}",
}


def _tracked_text_files() -> list[Path]:
    names = subprocess.run(["git", "ls-files"], cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout
    return [REPO_ROOT / name for name in names.splitlines() if (REPO_ROOT / name).is_file()]


def test_case_14_env_file_is_git_ignored() -> None:
    result = subprocess.run(["git", "check-ignore", "-q", ".env"], cwd=REPO_ROOT)

    assert result.returncode == 0


def test_case_14_no_secrets_in_tracked_files() -> None:
    settings = get_settings()
    secrets = {
        name: value
        for name in (
            "jwt_secret",
            "stripe_secret_key",
            "stripe_webhook_secret",
            "resend_api_key",
            "aws_access_key_id",
            "aws_secret_access_key",
            "twilio_auth_token",
        )
        if (value := getattr(settings, name)) and len(value) >= 12
    }
    findings: list[str] = []  # names and files only, never the secret values
    for path in _tracked_text_files():
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary file
        relative = path.relative_to(REPO_ROOT)
        findings += [f"{name} in {relative}" for name, value in secrets.items() if value in content]
        findings += [f"{label} pattern in {relative}" for label, regex in KEY_PATTERNS.items() if re.search(regex, content)]

    assert findings == []
