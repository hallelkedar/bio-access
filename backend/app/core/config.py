from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env lives at the repo root: backend/app/core/config.py -> parents[3]
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # Core (required)
    database_url: str
    jwt_secret: str

    jwt_expire_minutes: int = 60
    cors_origins: str = "https://localhost:5173"
    rate_limit_per_minute: int = 60
    max_upload_mb: int = 2

    # Face recognition
    face_provider: Literal["fake", "rekognition"] = "fake"
    aws_region: str = "eu-west-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    face_match_threshold: float = 95

    # Payments
    payment_provider: Literal["fake", "stripe"] = "fake"
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None

    # Notifications
    notifier: Literal["console", "resend+twilio"] = "console"
    resend_api_key: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from: str | None = None

    # Storage
    storage_provider: Literal["local", "s3"] = "local"
    s3_bucket: str | None = None

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
