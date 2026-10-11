import httpx

from app.providers.notify.base import NotificationError, SmsSender

TWILIO_API = "https://api.twilio.com/2010-04-01"


class TwilioSmsSender(SmsSender):
    """Sends SMS through Twilio's REST API. Trial accounts only reach verified numbers."""

    def __init__(
        self, account_sid: str, auth_token: str, sender: str, client: httpx.Client | None = None
    ) -> None:
        self._url = f"{TWILIO_API}/Accounts/{account_sid}/Messages.json"
        self._auth = (account_sid, auth_token)
        self._sender = sender
        self._client = client or httpx.Client(timeout=10.0)

    def send_sms(self, *, to: str, body: str) -> None:
        try:
            response = self._client.post(
                self._url, auth=self._auth, data={"To": to, "From": self._sender, "Body": body}
            )
        except httpx.HTTPError as exc:
            raise NotificationError(f"twilio request failed: {type(exc).__name__}") from None
        if response.is_error:
            raise NotificationError(
                f"twilio returned HTTP {response.status_code} (code {_error_code(response)})"
            )


def _error_code(response: httpx.Response) -> object:
    """Twilio's numeric error code (e.g. 21608 = unverified number on a trial account)."""
    try:
        return response.json().get("code")
    except ValueError:
        return None
