"""Reset the database to a clean presentation state. DESTRUCTIVE: deletes every user and event.

Usage (from backend/, with the same .env as the server):
    .venv/bin/python -m scripts.seed_demo --yes                 # gates open tomorrow
    .venv/bin/python -m scripts.seed_demo --yes --day 2026-10-14
Then give the events their covers: .venv/bin/python -m scripts.demo_covers --base-url <server>

1. Deletes every event's face collection at the face provider (no orphan faces left behind).
2. Deletes all access logs, face references, payments, tickets, events and users.
   The settings table (match threshold) is kept.
3. Creates 3 admins, 3 gatekeepers and 3 visitors (password DEMO_PASSWORD) and 7 events:
   three with the gate open all morning on --day, two on sale later, two closed ones.
4. Gives the closed events sample history so the dashboard and logs have something to show:
   ATTENDEES generated visitors with tickets, payments, entries over the evening and denials.
   Sample face entries have no similarity (they never went through a face provider), and no
   face references are created: there are no real faces behind them.
"""

import argparse
import random
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.access_log import AccessLog, AccessMethod, AccessReason, AccessResult
from app.models.biometric_profile import BiometricProfile
from app.models.event import Event, EventStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face import get_face_provider
from app.providers.face.base import FaceProvider
from app.schemas.event import EventCreate, EventUpdate
from app.services import event as event_service
from app.services.ticket import generate_qr_token

LOCAL_TZ = ZoneInfo("Asia/Jerusalem")
DEMO_PASSWORD = "12345678"

USERS: list[tuple[UserRole, str, str]] = [
    (UserRole.ADMIN, "Israel Biton", "israel.biton@example.com"),
    (UserRole.ADMIN, "Michal Levi", "michal.levi@example.com"),
    (UserRole.ADMIN, "Yossi Cohen", "yossi.cohen@example.com"),
    (UserRole.GATEKEEPER, "David Mizrahi", "david.mizrahi@example.com"),
    (UserRole.GATEKEEPER, "Noa Peretz", "noa.peretz@example.com"),
    (UserRole.GATEKEEPER, "Avi Friedman", "avi.friedman@example.com"),
    (UserRole.USER, "Dana Shapira", "dana.shapira@example.com"),
    (UserRole.USER, "Moshe Azulay", "moshe.azulay@example.com"),
    (UserRole.USER, "Yael Katz", "yael.katz@example.com"),
]


# Sample ticket holders for the closed events' history (they never need to log in).
ATTENDEES = 160
FIRST_NAMES = ["Noam", "Tamar", "Itai", "Shira", "Omer", "Maya", "Eitan", "Noa", "Yonatan", "Lior",
               "Ariel", "Roni", "Guy", "Hila", "Amit", "Yarden", "Nadav", "Inbar", "Tomer", "Adi"]
LAST_NAMES = ["Avraham", "Ben-David", "Dahan", "Gabay", "Halevi", "Malka", "Ohana", "Sasson", "Vaknin",
              "Yosef", "Amar", "Biton", "Elbaz", "Golan", "Harel", "Navon", "Oren", "Ronen", "Segal", "Tal"]
GATES = ("North", "South", "VIP")


@dataclass(frozen=True)
class History:
    sold: int
    no_shows: int  # paid but never came (stay VALID)


@dataclass(frozen=True)
class DemoEvent:
    name: str  # matches the artwork in scripts/demo_covers.py
    location: str
    day_offset: int  # days after --day
    start: time  # Israel time
    end: time
    capacity: int
    price_cents: int
    status: EventStatus
    history: History | None = None


EVENTS: list[DemoEvent] = [
    DemoEvent("Tel Aviv Tech Conference", "Expo Tel Aviv, Tel Aviv", 0, time(8, 0), time(23, 0), 500, 12000, EventStatus.ACTIVE),
    DemoEvent("Jazz Morning at the Port", "Haifa Port, Haifa", 0, time(7, 30), time(15, 0), 200, 8000, EventStatus.ACTIVE),
    DemoEvent("Book Fair", "Tel Aviv Port, Tel Aviv", 0, time(8, 0), time(20, 0), 1000, 0, EventStatus.ACTIVE),
    DemoEvent("Winter Gala", "Jerusalem International Convention Center, Jerusalem", 43, time(19, 0), time(23, 30), 300, 25000, EventStatus.ACTIVE),
    DemoEvent("Summer Concert", "Caesarea Amphitheater, Caesarea", 21, time(20, 0), time(23, 0), 800, 0, EventStatus.ACTIVE),
    DemoEvent("Spring Music Festival", "Yarkon Park, Tel Aviv", -1, time(16, 0), time(23, 0), 180, 9000, EventStatus.CLOSED,
              History(sold=150, no_shows=18)),
    DemoEvent("Jazz Night at the Port", "Haifa Port, Haifa", -7, time(20, 0), time(23, 30), 120, 8000, EventStatus.CLOSED,
              History(sold=95, no_shows=9)),
]


@dataclass(frozen=True)
class SeedSummary:
    collections_deleted: int
    users: int
    attendees: int
    events: int
    access_logs: int


def _at(day: date, at: time) -> datetime:
    return datetime.combine(day, at, tzinfo=LOCAL_TZ).astimezone(UTC)


def wipe(db: Session, face_provider: FaceProvider) -> int:
    """Delete every face collection, then every row except settings. Returns collections deleted."""
    event_ids = list(db.scalars(select(Event.id)))
    for event_id in event_ids:  # provider first: a failure leaves the database as it was
        face_provider.delete_collection(event_id)
    for model in (AccessLog, BiometricProfile, Payment, Ticket, Event, User):  # children before parents
        db.execute(delete(model))
    db.commit()
    return len(event_ids)


def _attendees(password_hash: str) -> list[User]:
    people = []
    for n in range(ATTENDEES):
        first, last = FIRST_NAMES[n % len(FIRST_NAMES)], LAST_NAMES[(n * 7) % len(LAST_NAMES)]
        email = f"{first}.{last}.{n + 1}@example.com".lower()
        people.append(User(email=email, full_name=f"{first} {last}", password_hash=password_hash, role=UserRole.USER))
    return people


def _log(event: Event, at: datetime, result: AccessResult, reason: AccessReason, method: AccessMethod,
         ticket: Ticket | None, rng: random.Random) -> AccessLog:
    return AccessLog(event_id=event.id, ticket_id=ticket.id if ticket else None, gate_id=rng.choice(GATES),
                     timestamp=at, result=result, reason=reason, method=method, similarity=None)


def add_history(db: Session, event: Event, history: History, people: list[User]) -> int:
    """Past tickets, payments and gate decisions for a finished event. Returns access logs added."""
    rng = random.Random(event.name)  # same history on every run
    holders = rng.sample(people, history.sold + 1)  # the extra one cancelled
    doors_open = event.starts_at - timedelta(hours=1)
    span = (event.ends_at - doors_open).total_seconds()

    def at(fraction: float) -> datetime:
        return doors_open + timedelta(seconds=span * fraction)

    tickets = []
    for i, person in enumerate(holders):
        status = TicketStatus.CANCELLED if i == history.sold else (
            TicketStatus.VALID if i >= history.sold - history.no_shows else TicketStatus.ENTERED)
        ticket = Ticket(event_id=event.id, user_id=person.id, qr_token=generate_qr_token(), status=status,
                        purchased_at=event.starts_at - timedelta(days=rng.uniform(1, 20)))
        tickets.append(ticket)
    db.add_all(tickets)
    db.flush()
    db.add_all(
        Payment(ticket_id=t.id, provider="seed", provider_session_id=f"seed_{secrets.token_hex(12)}",
                amount_cents=event.price_cents, currency=event.currency, created_at=t.purchased_at,
                status=PaymentStatus.FAILED if t.status == TicketStatus.CANCELLED else PaymentStatus.PAID)
        for t in tickets
    )

    approved, denied = AccessResult.APPROVED, AccessResult.DENIED
    logs = []
    for ticket in (t for t in tickets if t.status == TicketStatus.ENTERED):
        # Most people arrive around the start (a quarter of the way in), fewer later.
        ticket.entered_at = at(rng.triangular(0.0, 0.85, 0.22))
        by_qr = rng.random() < 0.15
        if by_qr and rng.random() < 0.3:  # the face service hiccuped first, then QR
            logs.append(_log(event, ticket.entered_at - timedelta(seconds=20), denied, AccessReason.PROVIDER_ERROR,
                             AccessMethod.FACE, None, rng))
        logs.append(_log(event, ticket.entered_at, approved, AccessReason.NONE,
                         AccessMethod.QR if by_qr else AccessMethod.FACE, ticket, rng))
        if rng.random() < 0.07:  # walked back to the gate later
            logs.append(_log(event, ticket.entered_at + timedelta(minutes=rng.uniform(3, 90)), denied,
                             AccessReason.ALREADY_ENTERED, AccessMethod.FACE, ticket, rng))
    for reason, count in ((AccessReason.NOT_RECOGNIZED, rng.randint(8, 14)), (AccessReason.LOW_QUALITY, rng.randint(6, 11))):
        logs += [_log(event, at(rng.triangular(0.0, 0.85, 0.22)), denied, reason, AccessMethod.FACE, None, rng)
                 for _ in range(count)]
    logs += [_log(event, doors_open - timedelta(minutes=rng.uniform(5, 30)), denied, AccessReason.EVENT_NOT_ACTIVE,
                  AccessMethod.FACE, None, rng) for _ in range(3)]
    cancelled = tickets[history.sold]
    logs.append(_log(event, at(0.3), denied, AccessReason.CANCELLED, AccessMethod.QR, cancelled, rng))
    db.add_all(logs)
    db.commit()
    return len(logs)


def seed(db: Session, face_provider: FaceProvider, day: date) -> SeedSummary:
    """wipe(), then the demo users and events. `day` is the presentation day (gates open)."""
    deleted = wipe(db, face_provider)

    password_hash = hash_password(DEMO_PASSWORD)  # bcrypt is slow: hash once
    users = [User(email=email, full_name=name, password_hash=password_hash, role=role) for role, name, email in USERS]
    people = _attendees(password_hash)
    db.add_all(users + people)
    db.commit()
    admin = users[0]

    logs = 0
    for spec in EVENTS:
        event_day = day + timedelta(days=spec.day_offset)
        event = event_service.create_event(
            db,
            EventCreate(
                name=spec.name,
                location=spec.location,
                starts_at=_at(event_day, spec.start),
                ends_at=_at(event_day, spec.end),
                capacity=spec.capacity,
                price_cents=spec.price_cents,
                currency="ILS",
            ),
            admin,
        )
        # Through the service, as in the app: activating creates the face collection.
        event_service.update_event(db, event.id, EventUpdate(status=spec.status), face_provider)
        if spec.history:
            logs += add_history(db, event, spec.history, people)
    return SeedSummary(collections_deleted=deleted, users=len(users), attendees=len(people), events=len(EVENTS),
                       access_logs=logs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="really delete every user, event and ticket")
    parser.add_argument("--day", type=date.fromisoformat, help="presentation day, YYYY-MM-DD (default: tomorrow)")
    args = parser.parse_args()
    if not args.yes:
        raise SystemExit("This deletes every user, event and ticket. Back up the database, then add --yes.")
    day = args.day or datetime.now(LOCAL_TZ).date() + timedelta(days=1)

    with SessionLocal() as db:
        summary = seed(db, get_face_provider(), day)
    print(f"deleted {summary.collections_deleted} face collection(s) and all rows except settings")
    print(f"created {summary.users} users (password {DEMO_PASSWORD}) and {summary.events} events; gates open on {day}")
    print(f"sample history: {summary.attendees} attendees, {summary.access_logs} gate decisions on the closed events")
    for role, name, email in USERS:
        print(f"  {role.value:<10} {name:<14} {email}")


if __name__ == "__main__":
    main()
