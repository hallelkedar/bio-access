import json

from fastapi import HTTPException, status
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MULTIPART_OVERHEAD_BYTES = 64 * 1024  # boundaries and part headers around an uploaded file


class BodySizeLimitMiddleware:
    """Reject request bodies over max_bytes before the app reads (or spools) them.

    A too-large Content-Length gets 413 without reading anything. Bodies without
    a length (chunked) are counted while streaming and cut off at the limit.
    Starlette would otherwise store a whole multipart upload in a temp file
    before any route could check its size.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > self.max_bytes:
            await _send_413(send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="request body too large")
            return message

        await self.app(scope, limited_receive, send)


async def _send_413(send: Send) -> None:
    body = json.dumps({"detail": "request body too large"}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})
