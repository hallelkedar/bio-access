from functools import lru_cache

from app.core.config import get_settings
from app.providers.notify.base import CompositeNotifier, EmailSender, Notifier, SmsSender
from app.providers.notify.console import ConsoleNotifier
from app.providers.notify.email_resend import ResendEmailSender


@lru_cache
def get_notifier() -> Notifier:
    """Build the notifier from EMAIL_PROVIDER and SMS_PROVIDER in .env (FastAPI dependency)."""
    settings = get_settings()

    email: EmailSender
    if settings.email_provider == "resend":
        if not settings.resend_api_key:
            raise RuntimeError("EMAIL_PROVIDER=resend requires RESEND_API_KEY in .env")
        email = ResendEmailSender(settings.resend_api_key, settings.email_from)
    else:
        email = ConsoleNotifier()

    sms: SmsSender
    if settings.sms_provider == "twilio":
        raise NotImplementedError("SMS_PROVIDER=twilio is not implemented yet")
    sms = ConsoleNotifier()

    return CompositeNotifier(email=email, sms=sms)
