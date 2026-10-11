import asyncio
from typing import Any

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
