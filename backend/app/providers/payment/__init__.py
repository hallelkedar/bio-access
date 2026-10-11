from functools import lru_cache

from app.core.config import get_settings
from app.providers.payment.base import PaymentProvider
from app.providers.payment.fake import FakePaymentProvider
from app.providers.payment.stripe_provider import StripePaymentProvider


@lru_cache
def get_payment_provider() -> PaymentProvider:
    """Pick the payment provider from PAYMENT_PROVIDER in .env (FastAPI dependency)."""
    settings = get_settings()
    if settings.payment_provider == "stripe":
        if not settings.stripe_secret_key:
            raise RuntimeError("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY in .env")
        return StripePaymentProvider(settings.stripe_secret_key, settings.stripe_webhook_secret)
    return FakePaymentProvider()
