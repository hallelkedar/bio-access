import asyncio
import logging

from starlette.websockets import WebSocket

from app.schemas.ws import WsMessage

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Keeps the open admin WebSockets and pushes messages to all of them (pub/sub).

    In-memory, so it only reaches clients of this server process; several
    workers would need a shared broker (e.g. Redis pub/sub).
    """

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    def __len__(self) -> int:
        return len(self._connections)

    async def connect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: WsMessage) -> int:
        """Send to every client; drop the ones that fail. Returns how many received it."""
        data = message.model_dump(mode="json")
        async with self._lock:
            targets = list(self._connections)
        dead: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(data)
            except Exception:
                dead.append(websocket)
        if dead:
            async with self._lock:
                self._connections.difference_update(dead)
            logger.info("dropped %d dead admin websocket(s)", len(dead))
        return len(targets) - len(dead)


manager = ConnectionManager()
