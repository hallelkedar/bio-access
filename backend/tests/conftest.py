from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from itertools import count

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers all models on Base.metadata)
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db, get_session_factory
from app.main import app
from app.models.event import Event, EventStatus
from app.models.user import User, UserRole
from app.providers.notify import get_notifier
from app.providers.payment import get_payment_provider
from app.providers.storage import get_storage
from app.providers.payment.fake import FakePaymentProvider
from app.repositories import user_repository
from tests.fakes import InMemoryStorage, RecordingNotifier

TEST_DB_NAME = "bioaccess_test"


def _create_test_database(url: str) -> None:
    admin_url = make_url(url).set(database="postgres")
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
        )
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    admin_engine.dispose()


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    dev_url = get_settings().database_url
    _create_test_database(dev_url)
    test_engine = create_engine(make_url(dev_url).set(database=TEST_DB_NAME))
    Base.metadata.drop_all(test_engine)
    Base.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """Session inside an outer transaction that is rolled back after each test.

    Commits made by the code under test only release a SAVEPOINT, so nothing
    is ever persisted between tests.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def notifier() -> RecordingNotifier:
    return RecordingNotifier()


@pytest.fixture
def storage() -> InMemoryStorage:
    return InMemoryStorage()


@pytest.fixture
def client(db: Session, notifier: RecordingNotifier, storage: InMemoryStorage) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    # Background tasks get their own sessions, still inside the test transaction.
    app.dependency_overrides[get_session_factory] = lambda: (
        lambda: Session(bind=db.bind, join_transaction_mode="create_savepoint")
    )
    # Never call a real payment provider or send real email/SMS from tests, whatever .env says.
    app.dependency_overrides[get_payment_provider] = FakePaymentProvider
    app.dependency_overrides[get_notifier] = lambda: notifier
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


_user_counter = count(1)


@pytest.fixture
def make_user(db: Session) -> Callable[..., User]:
    """Create and commit a user with the given role (password is not usable)."""

    def _make(role: UserRole = UserRole.USER, email: str | None = None) -> User:
        user = user_repository.create(
            db,
            email=email or f"{role.value.lower()}{next(_user_counter)}@example.com",
            full_name=f"Test {role.value.title()}",
            phone=None,
            password_hash="not-a-real-hash",
            role=role,
        )
        db.commit()
        return user

    return _make


@pytest.fixture
def auth_headers() -> Callable[[User], dict[str, str]]:
    def _headers(user: User) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}

    return _headers


@pytest.fixture
def make_event(db: Session, make_user: Callable[..., User]) -> Callable[..., Event]:
    """Create and commit an event (tomorrow, 4 hours long) created by a fresh admin."""

    def _make(status: EventStatus = EventStatus.DRAFT, **overrides: object) -> Event:
        starts_at = datetime.now(UTC) + timedelta(days=1)
        fields: dict[str, object] = {
            "name": "Test Concert",
            "location": "Tel Aviv",
            "starts_at": starts_at,
            "ends_at": starts_at + timedelta(hours=4),
            "capacity": 100,
            "price_cents": 5000,
            "currency": "ILS",
            "status": status,
            **overrides,
        }
        if "created_by" not in fields:
            fields["created_by"] = make_user(UserRole.ADMIN).id
        event = Event(**fields)
        db.add(event)
        db.commit()
        return event

    return _make
