"""The real enrollment and gate endpoints, running on the demo provider."""

import io
import os
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.main import app
from app.models.event import Event, EventStatus
from app.models.ticket import TicketStatus
from app.models.user import User, UserRole
from app.providers.face import get_face_provider
from app.providers.face.demo import DemoFaceProvider
from app.services import ticket as ticket_service
from tests.events import live_window

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]


def _webcam_frame() -> bytes:
    buffer = io.BytesIO()
    Image.frombytes("L", (640, 480), os.urandom(640 * 480)).convert("RGB").save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def demo(client: TestClient, tmp_path: Path) -> Iterator[DemoFaceProvider]:
    # The uploaded test pictures aren't faces: a stub detector "sees" one (counting is tested in unit tests).
    provider = DemoFaceProvider(tmp_path / "demo_faces.json", face_counter=lambda _picture: 1)
    app.dependency_overrides[get_face_provider] = lambda: provider
    yield provider


def test_enroll_then_any_frame_at_the_gate_admits_once(
    client: TestClient, db: Session, demo: DemoFaceProvider, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    holder = make_user()
    event = make_event(EventStatus.ACTIVE, **live_window())
    ticket = ticket_service.create_ticket(db, holder, event.id)
    ticket.status = TicketStatus.VALID
    db.commit()

    enrolled = client.post(
        f"/api/enrollment?ticket_id={ticket.id}&consent=true",
        content=_webcam_frame(),
        headers={**auth_headers(holder), "Content-Type": "image/jpeg"},
    )
    assert enrolled.status_code == 201, enrolled.text

    gate = {**auth_headers(make_user(UserRole.GATEKEEPER)), "Content-Type": "image/jpeg"}
    url = f"/api/gate/verify?event_id={event.id}&gate_id=demo"
    first = client.post(url, content=_webcam_frame(), headers=gate).json()  # a different frame, as with a webcam
    second = client.post(url, content=_webcam_frame(), headers=gate).json()

    assert (first["result"], first["user_name"], first["similarity"]) == ("APPROVED", holder.full_name, 99.0)
    assert second["reason"] == "ALREADY_ENTERED"
