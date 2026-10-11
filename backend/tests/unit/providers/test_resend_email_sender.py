"""Offline: Resend's API is replaced by an httpx MockTransport."""

import base64
import json
from collections.abc import Callable

import httpx
import pytest

from app.providers.notify.base import Attachment, NotificationError
from app.providers.notify.email_resend import RESEND_URL, ResendEmailSender

API_KEY = "re_test_secret_key"
SENDER = "BioAccess <onboarding@resend.dev>"


def _sender(handler: Callable[[httpx.Request], httpx.Response]) -> ResendEmailSender:
    return ResendEmailSender(API_KEY, SENDER, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_sends_expected_request() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "email_1"})

    _sender(handler).send_email(
        to="dana@example.com",
        subject="Your ticket",
        body="Hello",
        attachments=[Attachment("ticket-qr.png", b"\x89PNGdata", "image/png")],
    )

    request = seen[0]
    assert str(request.url) == RESEND_URL
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    body = json.loads(request.content)
    assert body["from"] == SENDER
    assert body["to"] == ["dana@example.com"]
    assert body["subject"] == "Your ticket"
    assert body["text"] == "Hello"
    assert body["attachments"] == [
        {"filename": "ticket-qr.png", "content": base64.b64encode(b"\x89PNGdata").decode()}
    ]


def test_no_attachments_key_when_none() -> None:
    seen: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "email_1"})

    _sender(handler).send_email(to="a@example.com", subject="s", body="b")

    assert "attachments" not in seen[0]


@pytest.mark.parametrize("status", [401, 422, 500])
def test_error_status_raises_without_leaking_key(status: int) -> None:
    sender = _sender(lambda request: httpx.Response(status, json={"message": "nope"}))

    with pytest.raises(NotificationError, match=str(status)) as exc_info:
        sender.send_email(to="a@example.com", subject="s", body="b")
    assert API_KEY not in str(exc_info.value)


def test_network_error_raises_notification_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with pytest.raises(NotificationError, match="ConnectTimeout") as exc_info:
        _sender(handler).send_email(to="a@example.com", subject="s", body="b")
    assert exc_info.value.__cause__ is None  # no chained exception carrying request details
