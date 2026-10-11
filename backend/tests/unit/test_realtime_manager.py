import asyncio
from typing import Any

import pytest

from app.schemas.ws import WsMessage
from app.services.realtime import ConnectionManager


class FakeSocket:
    def __init__(self, broken: bool = False) -> None:
        self.broken = broken
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, data: dict[str, Any]) -> None:
        if self.broken:
            raise RuntimeError("connection closed")
        self.sent.append(data)


def test_broadcast_reaches_every_client() -> None:
    manager = ConnectionManager()
    first, second = FakeSocket(), FakeSocket()

    async def scenario() -> int:
        await manager.connect(first)  # type: ignore[arg-type]
        await manager.connect(second)  # type: ignore[arg-type]
        return await manager.broadcast(WsMessage(type="access_event", payload={"result": "APPROVED"}))

    assert asyncio.run(scenario()) == 2
    assert first.sent == second.sent == [{"type": "access_event", "payload": {"result": "APPROVED"}}]


def test_dead_client_is_dropped_others_still_receive() -> None:
    manager = ConnectionManager()
    alive, dead = FakeSocket(), FakeSocket(broken=True)

    async def scenario() -> int:
        await manager.connect(alive)  # type: ignore[arg-type]
        await manager.connect(dead)  # type: ignore[arg-type]
        return await manager.broadcast(WsMessage(type="stats_update"))

    assert asyncio.run(scenario()) == 1
    assert len(alive.sent) == 1
    assert len(manager) == 1


def test_disconnect_removes_client() -> None:
    manager = ConnectionManager()
    socket = FakeSocket()

    async def scenario() -> None:
        await manager.connect(socket)  # type: ignore[arg-type]
        await manager.disconnect(socket)  # type: ignore[arg-type]
        await manager.disconnect(socket)  # type: ignore[arg-type]  # twice: no error
        await manager.broadcast(WsMessage(type="stats_update"))

    asyncio.run(scenario())
    assert socket.sent == []
    assert len(manager) == 0


def test_access_event_message_contents() -> None:
    from datetime import UTC, datetime

    from app.models.access_log import AccessMethod, AccessReason, AccessResult
    from app.schemas.gate import GateVerifyResult
    from app.services.realtime import access_event_message

    decision = GateVerifyResult(result=AccessResult.DENIED, reason=AccessReason.NOT_RECOGNIZED)

    message = access_event_message(7, "north-1", AccessMethod.QR, decision, datetime(2026, 12, 1, 20, 0, tzinfo=UTC))

    assert message.type == "access_event"
    assert message.payload == {
        "event_id": 7,
        "gate_id": "north-1",
        "method": "QR",
        "result": "DENIED",
        "reason": "NOT_RECOGNIZED",
        "ticket_id": None,
        "user_name": None,
        "similarity": None,
        "timestamp": "2026-12-01T20:00:00Z",
    }


def test_publish_never_raises(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    from app.services import realtime

    async def broken_broadcast(_: WsMessage) -> int:
        raise RuntimeError("feed down")

    monkeypatch.setattr(realtime.manager, "broadcast", broken_broadcast)

    asyncio.run(realtime.publish_access_event(WsMessage(type="access_event")))  # no exception

    assert "could not publish access event" in caplog.text
