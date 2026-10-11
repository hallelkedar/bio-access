from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.security import create_access_token
from app.models.user import User, UserRole

MakeUser = Callable[..., User]
URL = "/ws/admin"


def _token(user: User) -> str:
    return create_access_token(user.id, user.role)


def _close_code(client: TestClient, first_message: object) -> int:
    with client.websocket_connect(URL) as ws:
        ws.send_json(first_message)
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    return exc_info.value.code


def test_admin_connects_and_gets_pong(client: TestClient, make_user: MakeUser) -> None:
    with client.websocket_connect(URL) as ws:
        ws.send_json({"type": "auth", "token": _token(make_user(UserRole.ADMIN))})
        assert ws.receive_json() == {"type": "connected", "payload": {}}

        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong", "payload": {}}


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_non_admin_closed_4403(client: TestClient, make_user: MakeUser, role: UserRole) -> None:
    assert _close_code(client, {"type": "auth", "token": _token(make_user(role))}) == 4403


@pytest.mark.parametrize(
    "first_message",
    [
        {"type": "auth", "token": "not-a-jwt"},
        {"type": "ping"},  # anything but auth first
        {"type": "auth"},  # no token
    ],
)
def test_bad_auth_closed_4401(client: TestClient, first_message: object) -> None:
    assert _close_code(client, first_message) == 4401


def test_silent_client_times_out(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.ws.AUTH_TIMEOUT_SECONDS", 0.05)

    with client.websocket_connect(URL) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()

    assert exc_info.value.code == 4401
