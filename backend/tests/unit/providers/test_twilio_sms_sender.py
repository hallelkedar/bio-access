"""Offline: Twilio's API is replaced by an httpx MockTransport."""

import base64
from collections.abc import Callable
from urllib.parse import parse_qs

import httpx
import pytest

from app.providers.notify.base import NotificationError
from app.providers.notify.sms_twilio import TwilioSmsSender

SID = "ACtest123"
TOKEN = "twilio_secret_token"
SENDER = "+15005550006"


def _sender(handler: Callable[[httpx.Request], httpx.Response]) -> TwilioSmsSender:
    return TwilioSmsSender(SID, TOKEN, SENDER, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_sends_expected_request() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201, json={"sid": "SM1"})

    _sender(handler).send_sms(to="+972501234567", body="Hello")

    request = seen[0]
    assert str(request.url) == f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json"
    expected_auth = base64.b64encode(f"{SID}:{TOKEN}".encode()).decode()
    assert request.headers["authorization"] == f"Basic {expected_auth}"
    assert parse_qs(request.content.decode()) == {"To": ["+972501234567"], "From": [SENDER], "Body": ["Hello"]}


def test_error_includes_twilio_code_but_not_token() -> None:
    sender = _sender(lambda request: httpx.Response(400, json={"code": 21608, "message": "unverified"}))

    with pytest.raises(NotificationError, match="HTTP 400 \\(code 21608\\)") as exc_info:
        sender.send_sms(to="+972501234567", body="Hello")
    assert TOKEN not in str(exc_info.value)


def test_non_json_error_still_raises() -> None:
    sender = _sender(lambda request: httpx.Response(503, text="Service Unavailable"))

    with pytest.raises(NotificationError, match="HTTP 503 \\(code None\\)"):
        sender.send_sms(to="+972501234567", body="Hello")


def test_network_error_raises_notification_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(NotificationError, match="ReadTimeout") as exc_info:
        _sender(handler).send_sms(to="+972501234567", body="Hello")
    assert exc_info.value.__cause__ is None
