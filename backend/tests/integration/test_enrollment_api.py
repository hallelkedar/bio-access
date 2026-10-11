import builtins
import tempfile
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User, UserRole
from app.providers.face.base import QualityIssue, QualityResult
from app.providers.face.fake import FakeFaceProvider
from tests.images import image_bytes, noise_png

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]

PHOTO = image_bytes("JPEG", (64, 64))


def _valid_ticket(client: TestClient, db: Session, make_event: MakeEvent, headers: dict[str, str]) -> int:
    ticket_id: int = client.post(
        "/api/tickets", json={"event_id": make_event(EventStatus.ACTIVE).id}, headers=headers
    ).json()["id"]
    from app.models.ticket import Ticket

    ticket = db.get(Ticket, ticket_id)
    assert ticket is not None
    ticket.status = TicketStatus.VALID
    db.commit()
    return ticket_id


def _enroll(
    client: TestClient, ticket_id: int, headers: dict[str, str], body: bytes = PHOTO, consent: str = "true"
) -> Any:
    return client.post(
        f"/api/enrollment?ticket_id={ticket_id}&consent={consent}",
        content=body,
        headers={**headers, "Content-Type": "image/jpeg"},
    )


def test_enrollment_creates_profile(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)

    response = _enroll(client, ticket_id, headers)

    assert response.status_code == 201
    body = response.json()
    assert body["ticket_id"] == ticket_id
    assert "face_id" not in body
    assert db.scalars(select(BiometricProfile).where(BiometricProfile.ticket_id == ticket_id)).first()


def test_image_never_written_to_disk(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)
    real_open = builtins.open

    def no_write_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if any(flag in mode for flag in "wax+"):
            raise AssertionError(f"file write attempted: {file!r}")
        return real_open(file, mode, *args, **kwargs)

    def no_tempfile(*_: Any, **__: Any) -> Any:
        raise AssertionError("temp file created")

    monkeypatch.setattr(builtins, "open", no_write_open)
    for name in ("SpooledTemporaryFile", "NamedTemporaryFile", "TemporaryFile", "mkstemp"):
        monkeypatch.setattr(tempfile, name, no_tempfile)

    big_photo = noise_png((650, 650))  # > 1 MB: UploadFile would spool this to disk
    assert len(big_photo) > 1024 * 1024

    response = _enroll(client, ticket_id, headers, body=big_photo)

    assert response.status_code == 201


def test_consent_false_returns_422(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)

    assert _enroll(client, ticket_id, headers, consent="false").status_code == 422


def test_low_quality_returns_issues(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)
    face_provider.set_quality(PHOTO, QualityResult((QualityIssue.BLURRY,)))

    response = _enroll(client, ticket_id, headers)

    assert response.status_code == 422
    assert response.json()["detail"]["issues"] == ["BLURRY"]


def test_second_enrollment_returns_409(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)
    _enroll(client, ticket_id, headers)

    assert _enroll(client, ticket_id, headers).status_code == 409


def test_unpaid_ticket_returns_409(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = client.post("/api/tickets", json={"event_id": make_event(EventStatus.ACTIVE).id}, headers=headers).json()["id"]

    assert _enroll(client, ticket_id, headers).status_code == 409


def test_other_users_ticket_returns_404(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    ticket_id = _valid_ticket(client, db, make_event, auth_headers(make_user()))

    assert _enroll(client, ticket_id, auth_headers(make_user())).status_code == 404


def test_webp_returns_415(
    client: TestClient, db: Session, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)

    assert _enroll(client, ticket_id, headers, body=image_bytes("WEBP")).status_code == 415


def test_too_large_returns_413(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings

    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)

    assert _enroll(client, ticket_id, headers).status_code == 413


def test_provider_down_returns_503(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    headers = auth_headers(make_user())
    ticket_id = _valid_ticket(client, db, make_event, headers)
    face_provider.available = False

    assert _enroll(client, ticket_id, headers).status_code == 503


@pytest.mark.parametrize("role", [UserRole.GATEKEEPER, UserRole.ADMIN])
def test_only_users_enroll(client: TestClient, make_user: MakeUser, auth_headers: Headers, role: UserRole) -> None:
    assert _enroll(client, 1, auth_headers(make_user(role))).status_code == 403
