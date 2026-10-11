from functools import lru_cache

from app.core.config import get_settings
from app.providers.notify.base import Notifier
from app.providers.notify.console import ConsoleNotifier


@lru_cache
def get_notifier() -> Notifier:
    """Pick the notifier from NOTIFIER in .env (FastAPI dependency)."""
    name = get_settings().notifier
    if name == "console":
        return ConsoleNotifier()
    raise NotImplementedError(f"notifier {name!r} is not implemented yet")
