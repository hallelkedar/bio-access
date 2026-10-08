from collections.abc import Callable
from contextlib import nullcontext

import pytest
from sqlalchemy.orm import Session

from app.cli import create_admin
from app.models.user import UserRole
from app.repositories import user_repository

ARGS = ["--email", "Admin@Example.com", "--name", "Site Admin"]


@pytest.fixture
def run_cli(db: Session, monkeypatch: pytest.MonkeyPatch) -> Callable[..., int]:
    """Run the CLI against the test session with scripted password answers."""
    monkeypatch.setattr(create_admin, "SessionLocal", lambda: nullcontext(db))

    def _run(argv: list[str], passwords: list[str]) -> int:
        answers = iter(passwords)
        monkeypatch.setattr(create_admin, "getpass", lambda prompt: next(answers))
        return create_admin.main(argv)

    return _run


def test_creates_admin(run_cli: Callable[..., int], db: Session) -> None:
    exit_code = run_cli(ARGS, ["s3cret-pass", "s3cret-pass"])

    assert exit_code == 0
    user = user_repository.get_by_email(db, "admin@example.com")
    assert user is not None
    assert user.role == UserRole.ADMIN


def test_password_mismatch_fails(run_cli: Callable[..., int], db: Session) -> None:
    exit_code = run_cli(ARGS, ["s3cret-pass", "other-pass"])

    assert exit_code == 1
    assert user_repository.get_by_email(db, "admin@example.com") is None


def test_short_password_fails(run_cli: Callable[..., int], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = run_cli(ARGS, ["short", "short"])

    assert exit_code == 1
    assert "password" in capsys.readouterr().err


def test_existing_email_fails(run_cli: Callable[..., int], capsys: pytest.CaptureFixture[str]) -> None:
    run_cli(ARGS, ["s3cret-pass", "s3cret-pass"])

    exit_code = run_cli(ARGS, ["s3cret-pass", "s3cret-pass"])

    assert exit_code == 1
    assert "already registered" in capsys.readouterr().err
