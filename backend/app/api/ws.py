import asyncio
from collections.abc import Callable

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models.user import User, UserRole
from app.schemas.ws import WsAuth, WsMessage
from app.services import auth as auth_service
from app.services.realtime import manager

router = APIRouter(tags=["realtime"])

AUTH_TIMEOUT_SECONDS = 5.0
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403


def _user_from_token(session_factory: Callable[[], Session], token: str) -> User | None:
    with session_factory() as db:
        try:
            return auth_service.get_user_from_token(db, token)
        except auth_service.InvalidCredentialsError:
            return None


@router.websocket("/ws/admin")
async def admin_feed(
    websocket: WebSocket, session_factory: Callable[[], Session] = Depends(get_session_factory)
) -> None:
    """Live feed for admin dashboards.

    Protocol: connect, then send {"type": "auth", "token": "<JWT>"} within 5 s.
    Closes with 4401 (bad/missing token) or 4403 (not an admin).
    Afterwards the server pushes WsMessage JSON; {"type": "ping"} gets a pong.
    Browsers on a foreign origin are refused (4403): CORS doesn't cover WebSockets.
    """
    await websocket.accept()
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in get_settings().cors_origins_list:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return
    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=AUTH_TIMEOUT_SECONDS)
        auth = WsAuth.model_validate(raw)
    except (TimeoutError, ValidationError, ValueError):
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return
    except WebSocketDisconnect:
        return

    user = await run_in_threadpool(_user_from_token, session_factory, auth.token)
    if user is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return
    if user.role != UserRole.ADMIN:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return

    await manager.connect(websocket)
    try:
        await websocket.send_json(WsMessage(type="connected").model_dump(mode="json"))
        while True:
            message = await websocket.receive_json()
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json(WsMessage(type="pong").model_dump(mode="json"))
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        await manager.disconnect(websocket)
