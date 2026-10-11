from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.security import InvalidTokenError, decode_access_token

# Counters live in this process's memory; several workers would need shared storage (e.g. Redis).
# get_remote_address uses the direct connection's IP. X-Forwarded-For is deliberately not
# trusted (any client can forge it); behind a reverse proxy, configure the proxy instead.
limiter = Limiter(key_func=get_remote_address)


def gatekeeper_key(request: Request) -> str:
    """Rate-limit gates per gatekeeper account: gates on one venue Wi-Fi share an IP."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        try:
            return f"user:{decode_access_token(header[7:]).user_id}"
        except InvalidTokenError:
            pass  # the route's auth will reject it; count it against the IP meanwhile
    return f"ip:{get_remote_address(request)}"


def auth_limit() -> str:
    return get_settings().auth_rate_limit


def gate_limit() -> str:
    return get_settings().gate_rate_limit


def rate_limit_exceeded_handler(request: Request, exc: Exception) -> JSONResponse:
    retry_after = 60
    if isinstance(exc, RateLimitExceeded) and exc.limit is not None:
        retry_after = exc.limit.limit.get_expiry()
    return JSONResponse(
        status_code=429, content={"detail": "rate limit exceeded"}, headers={"Retry-After": str(retry_after)}
    )
