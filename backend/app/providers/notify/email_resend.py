import base64
from collections.abc import Sequence

import httpx

from app.providers.notify.base import Attachment, EmailSender, NotificationError

RESEND_URL = "https://api.resend.com/emails"


class ResendEmailSender(EmailSender):
    """Sends email through Resend's REST API (https://resend.com/docs/api-reference)."""

    def __init__(self, api_key: str, sender: str, client: httpx.Client | None = None) -> None:
        self._api_key = api_key
        self._sender = sender
        self._client = client or httpx.Client(timeout=10.0)

    def send_email(
        self, *, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
    ) -> None:
        message: dict[str, object] = {
            "from": self._sender,
            "to": [to],
            "subject": subject,
            "text": body,
        }
        if attachments:
            message["attachments"] = [
                {"filename": a.filename, "content": base64.b64encode(a.content).decode("ascii")}
                for a in attachments
            ]
        try:
            response = self._client.post(
                RESEND_URL, json=message, headers={"Authorization": f"Bearer {self._api_key}"}
            )
        except httpx.HTTPError as exc:
            raise NotificationError(f"resend request failed: {type(exc).__name__}") from None
        if response.is_error:
            raise NotificationError(f"resend returned HTTP {response.status_code}")
