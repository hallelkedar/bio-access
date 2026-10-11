import pytest
from pydantic import ValidationError

from app.schemas.user import UserCreate


def _create(phone: str | None) -> UserCreate:
    return UserCreate(email="a@example.com", full_name="A", phone=phone, password="password123")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("050-123-4567", "+972501234567"),
        ("0501234567", "+972501234567"),
        ("+972 50 123 4567", "+972501234567"),
        ("00972501234567", "+972501234567"),
        ("+1 (415) 555-0100", "+14155550100"),
    ],
)
def test_phone_normalized_to_e164(raw: str, expected: str) -> None:
    assert _create(raw).phone == expected


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_missing_phone_is_none(raw: str | None) -> None:
    assert _create(raw).phone is None


@pytest.mark.parametrize("raw", ["hello", "12345", "+0501234567", "+97250123456789012"])
def test_invalid_phone_rejected(raw: str) -> None:
    with pytest.raises(ValidationError, match="phone"):
        _create(raw)
