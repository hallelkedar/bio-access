from collections.abc import Iterator

import pytest

from app.core.config import Settings
from app.providers import payment as payment_providers
from app.providers.payment.fake import FakePaymentProvider
from app.providers.payment.stripe_provider import StripePaymentProvider


@pytest.fixture(autouse=True)
def _clear_cache() -> Iterator[None]:
    payment_providers.get_payment_provider.cache_clear()
    yield
    payment_providers.get_payment_provider.cache_clear()


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    settings = Settings(**overrides)  # type: ignore[arg-type]
    monkeypatch.setattr(payment_providers, "get_settings", lambda: settings)


def test_fake_selected(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, payment_provider="fake")

    assert isinstance(payment_providers.get_payment_provider(), FakePaymentProvider)


def test_stripe_selected(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, payment_provider="stripe", stripe_secret_key="sk_test_dummy")

    assert isinstance(payment_providers.get_payment_provider(), StripePaymentProvider)


def test_stripe_without_key_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, payment_provider="stripe", stripe_secret_key=None)

    with pytest.raises(RuntimeError, match="STRIPE_SECRET_KEY"):
        payment_providers.get_payment_provider()
