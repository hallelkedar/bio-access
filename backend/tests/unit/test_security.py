import pytest

from app.core.security import MAX_PASSWORD_BYTES, hash_password, verify_password


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
