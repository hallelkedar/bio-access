from functools import lru_cache

from app.core.config import get_settings
from app.providers.payment.base import PaymentProvider
from app.providers.payment.fake import FakePaymentProvider


@lru_cache
def get_payment_provider() -> PaymentProvider:
    """Pick the payment provider from PAYMENT_PROVIDER in .env (FastAPI dependency)."""
    name = get_settings().payment_provider
    if name == "fake":
        return FakePaymentProvider()
    raise NotImplementedError(f"payment provider {name!r} is not implemented yet")
