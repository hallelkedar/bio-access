from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.security import (
    JWT_ALGORITHM,
    MAX_PASSWORD_BYTES,
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.user import UserRole


def test_correct_password_verifies() -> None:
    password_hash = hash_password("s3cret-pass")
    assert verify_password("s3cret-pass", password_hash) is True


def test_wrong_password_fails() -> None:
    password_hash = hash_password("s3cret-pass")
    assert verify_password("wrong-pass", password_hash) is False


def test_hash_is_salted_and_not_plaintext() -> None:
    first = hash_password("same-password")
    second = hash_password("same-password")
    assert first != second
    assert "same-password" not in first


def test_password_over_72_bytes_rejected_on_hash() -> None:
    with pytest.raises(ValueError):
        hash_password("a" * (MAX_PASSWORD_BYTES + 1))


def test_password_over_72_bytes_fails_verify() -> None:
    password_hash = hash_password("a" * MAX_PASSWORD_BYTES)
    assert verify_password("a" * (MAX_PASSWORD_BYTES + 1), password_hash) is False


def test_malformed_hash_fails_verify() -> None:
    assert verify_password("anything", "not-a-bcrypt-hash") is False


def test_token_roundtrip_keeps_user_id_and_role() -> None:
    token = create_access_token(42, UserRole.ADMIN)
    payload = decode_access_token(token)

    assert payload.user_id == 42
    assert payload.role == UserRole.ADMIN


def test_expired_token_rejected() -> None:
    token = create_access_token(42, UserRole.USER, expires_delta=timedelta(seconds=-1))

    with pytest.raises(InvalidTokenError):
        decode_access_token(token)


def test_token_signed_with_other_secret_rejected() -> None:
    forged = jwt.encode(
        {"sub": "42", "role": "ADMIN", "exp": datetime.now(UTC) + timedelta(minutes=5)},
        "x" * 32,
        algorithm=JWT_ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        decode_access_token(forged)


def test_garbage_token_rejected() -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token("not-a-jwt")
