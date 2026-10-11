import pytest

from app.providers.notify.base import Attachment
from app.providers.notify.console import ConsoleNotifier


def test_email_is_printed(capsys: pytest.CaptureFixture[str]) -> None:
    ConsoleNotifier().send_email(to="a@example.com", subject="Hello", body="Body text")

    out = capsys.readouterr().out
    assert "[EMAIL] to=a@example.com subject='Hello'" in out
    assert "Body text" in out


def test_attachment_is_listed_not_dumped(capsys: pytest.CaptureFixture[str]) -> None:
    ConsoleNotifier().send_email(
        to="a@example.com", subject="Hi", body="x", attachments=[Attachment("qr.png", b"\x89PNG-secret", "image/png")]
    )

    out = capsys.readouterr().out
    assert "[attachment] qr.png (11 bytes)" in out
    assert "secret" not in out


def test_sms_is_printed(capsys: pytest.CaptureFixture[str]) -> None:
    ConsoleNotifier().send_sms(to="+972500000000", body="Short text")

    out = capsys.readouterr().out
    assert "[SMS] to=+972500000000" in out
    assert "Short text" in out
