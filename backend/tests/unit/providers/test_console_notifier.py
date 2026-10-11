from collections.abc import Iterator

import pytest

from app.core.config import Settings
from app.providers import notify as notify_providers
from app.providers.notify.console import ConsoleNotifier


def test_email_is_printed(capsys: pytest.CaptureFixture[str]) -> None:
    ConsoleNotifier().send_email(to="a@example.com", subject="Hello", body="Body text")

    out = capsys.readouterr().out
    assert "[EMAIL] to=a@example.com subject='Hello'" in out
    assert "Body text" in out


def test_sms_is_printed(capsys: pytest.CaptureFixture[str]) -> None:
    ConsoleNotifier().send_sms(to="+972500000000", body="Short text")

    out = capsys.readouterr().out
    assert "[SMS] to=+972500000000" in out
    assert "Short text" in out


@pytest.fixture
def _clear_cache() -> Iterator[None]:
    notify_providers.get_notifier.cache_clear()
    yield
    notify_providers.get_notifier.cache_clear()


@pytest.mark.usefixtures("_clear_cache")
def test_factory_selects_console(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(notifier="console")  # type: ignore[call-arg]
    monkeypatch.setattr(notify_providers, "get_settings", lambda: settings)

    assert isinstance(notify_providers.get_notifier(), ConsoleNotifier)
