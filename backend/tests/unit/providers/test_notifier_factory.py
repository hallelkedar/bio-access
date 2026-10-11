from collections.abc import Iterator

import pytest

from app.core.config import Settings
from app.providers import notify as notify_providers
from app.providers.notify.base import CompositeNotifier
from app.providers.notify.console import ConsoleNotifier
from app.providers.notify.email_resend import ResendEmailSender


@pytest.fixture(autouse=True)
def _clear_cache() -> Iterator[None]:
    notify_providers.get_notifier.cache_clear()
    yield
    notify_providers.get_notifier.cache_clear()


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    settings = Settings(**overrides)  # type: ignore[arg-type]
    monkeypatch.setattr(notify_providers, "get_settings", lambda: settings)


def test_console_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, email_provider="console", sms_provider="console")

    notifier = notify_providers.get_notifier()

    assert isinstance(notifier, CompositeNotifier)
    assert isinstance(notifier.email, ConsoleNotifier)
    assert isinstance(notifier.sms, ConsoleNotifier)


def test_resend_email_with_console_sms(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, email_provider="resend", sms_provider="console", resend_api_key="re_test")

    notifier = notify_providers.get_notifier()

    assert isinstance(notifier, CompositeNotifier)
    assert isinstance(notifier.email, ResendEmailSender)
    assert isinstance(notifier.sms, ConsoleNotifier)


def test_resend_without_key_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, email_provider="resend", resend_api_key=None)

    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        notify_providers.get_notifier()
