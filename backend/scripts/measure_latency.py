"""Measure gate verification latency against a running server (BUILD_PLAN 12.4).

Usage (from backend/, server running with the same .env):
    .venv/bin/python -m scripts.measure_latency --base-url http://localhost:8000 --report ../docs/latency.md
    # Docker stack: --base-url https://localhost   ·   real AWS: FACE_PROVIDER=rekognition + --photo me.jpg

Seeds `latency-test-*` records, measures, prints a summary, optionally writes a markdown report,
and deletes everything it created (also the event's face collection).
"""

import argparse
import io
import math
import os
import platform
import secrets
import statistics
import uuid
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter

import httpx
from PIL import Image
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.access_log import AccessLog
from app.models.biometric_profile import BiometricProfile
from app.models.event import Event
from app.models.payment import Payment
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.providers.face import get_face_provider

TARGET_MS = 800.0
GATEKEEPERS = 6  # rotate so no gatekeeper exceeds the 120/minute gate rate limit
TAG = f"latency-test-{uuid.uuid4().hex[:6]}"


@dataclass
class Sample:
    client_ms: float
    server: dict[str, float]
    result: str


@dataclass
class Scenario:
    name: str
    description: str
    samples: list[Sample] = field(default_factory=list)


def percentile(values: Sequence[float], pct: float) -> float:
    """Nearest-rank percentile (pct in 0-100) of a non-empty list."""
    ordered = sorted(values)
    rank = max(1, min(len(ordered), math.ceil(pct / 100 * len(ordered))))
    return ordered[rank - 1]


def summarize(values: Sequence[float]) -> dict[str, float]:
    if not values:
        return {}
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "p99": percentile(values, 99),
        "max": max(values),
    }


def parse_server_timing(header: str) -> dict[str, float]:
    result: dict[str, float] = {}
    for part in filter(None, (p.strip() for p in header.split(","))):
        name, _, value = part.partition(";dur=")
        if value:
            result[name] = float(value)
    return result


def synthetic_photo() -> bytes:
    """A detailed, well-lit 640x480 JPEG; enough for the demo provider (not for Rekognition)."""
    buffer = io.BytesIO()
    Image.frombytes("L", (640, 480), os.urandom(640 * 480)).convert("RGB").save(buffer, format="JPEG")
    return buffer.getvalue()


class Harness:
    def __init__(self, base_url: str, insecure: bool) -> None:
        self.http = httpx.Client(base_url=base_url, verify=not insecure, timeout=30)
        self.user_ids: list[int] = []
        self.event_ids: list[int] = []
        self.gatekeeper_tokens: list[str] = []
        self.next_gate = 0

    # --- setup -----------------------------------------------------------------------
    def make_user(self, role: UserRole) -> tuple[int, str]:
        with SessionLocal() as db:
            user = User(email=f"{TAG}-{secrets.token_hex(3)}@example.com", full_name=f"Latency {role.value.title()}",
                        password_hash="not-a-login", role=role)
            db.add(user)
            db.commit()
            self.user_ids.append(user.id)
            return user.id, create_access_token(user.id, user.role)

    def create_event(self, admin_token: str, name: str) -> int:
        starts = datetime.now(UTC) + timedelta(minutes=10)
        body = {"name": f"{TAG} {name}", "location": "Benchmark Hall, Tel Aviv", "starts_at": starts.isoformat(),
                "ends_at": (starts + timedelta(hours=4)).isoformat(), "capacity": 1000, "price_cents": 0, "currency": "ILS"}
        auth = {"Authorization": f"Bearer {admin_token}"}
        created = self.http.post("/api/events", json=body, headers=auth)
        created.raise_for_status()
        event_id: int = created.json()["id"]
        self.event_ids.append(event_id)
        self.http.put(f"/api/events/{event_id}", json={"status": "ACTIVE"}, headers=auth).raise_for_status()
        return event_id

    def valid_tickets(self, user_id: int, event_id: int, count: int) -> list[Ticket]:
        """Paid tickets without going through the payment provider (not what we measure).

        One ticket per user and event: extra visitors are created as needed.
        """
        tickets: list[Ticket] = []
        with SessionLocal() as db:
            for i in range(count):
                owner = user_id if i == 0 else self.make_user(UserRole.USER)[0]
                ticket = Ticket(event_id=event_id, user_id=owner, qr_token=secrets.token_urlsafe(32), status=TicketStatus.VALID)
                db.add(ticket)
                tickets.append(ticket)
            db.commit()
            for ticket in tickets:
                db.refresh(ticket)
                db.expunge(ticket)
        return tickets

    def enroll(self, token: str, ticket_id: int, photo: bytes) -> None:
        response = self.http.post(f"/api/enrollment?ticket_id={ticket_id}&consent=true", content=photo,
                                  headers={"Authorization": f"Bearer {token}", "Content-Type": "image/jpeg"})
        if response.status_code != 201:
            raise SystemExit(f"enrollment failed ({response.status_code}): {response.text}")

    # --- measuring -------------------------------------------------------------------
    def _gate_headers(self) -> dict[str, str]:
        token = self.gatekeeper_tokens[self.next_gate % len(self.gatekeeper_tokens)]
        self.next_gate += 1
        return {"Authorization": f"Bearer {token}"}

    def _timed(self, send: Callable[[], httpx.Response]) -> Sample:
        start = perf_counter()
        response = send()
        elapsed = (perf_counter() - start) * 1000
        response.raise_for_status()
        body = response.json()
        return Sample(elapsed, parse_server_timing(response.headers.get("server-timing", "")),
                      body["result"] if body["result"] == "APPROVED" else body["reason"])

    def face(self, event_id: int, photo: bytes) -> Sample:
        headers = {**self._gate_headers(), "Content-Type": "image/jpeg"}
        return self._timed(lambda: self.http.post(f"/api/gate/verify?event_id={event_id}&gate_id=bench", content=photo, headers=headers))

    def qr(self, event_id: int, token: str) -> Sample:
        headers = self._gate_headers()
        body = {"event_id": event_id, "gate_id": "bench-qr", "qr_token": token}
        return self._timed(lambda: self.http.post("/api/gate/verify-qr", json=body, headers=headers))

    # --- cleanup ---------------------------------------------------------------------
    def cleanup(self) -> None:
        with SessionLocal() as db:
            ticket_ids = list(db.scalars(select(Ticket.id).where(Ticket.event_id.in_(self.event_ids))))
            db.execute(delete(AccessLog).where(AccessLog.event_id.in_(self.event_ids)))
            db.execute(delete(BiometricProfile).where(BiometricProfile.ticket_id.in_(ticket_ids)))
            db.execute(delete(Payment).where(Payment.ticket_id.in_(ticket_ids)))
            db.execute(delete(Ticket).where(Ticket.id.in_(ticket_ids)))
            db.execute(delete(Event).where(Event.id.in_(self.event_ids)))
            db.execute(delete(User).where(User.id.in_(self.user_ids)))
            db.commit()
        provider = get_face_provider()
        for event_id in self.event_ids:
            try:
                provider.delete_collection(event_id)
            except Exception as exc:  # cleanup must not hide the results
                print(f"note: could not delete face collection for event {event_id}: {type(exc).__name__}")


def run(args: argparse.Namespace) -> list[Scenario]:
    harness = Harness(args.base_url, args.insecure)
    photo = Path(args.photo).read_bytes() if args.photo else synthetic_photo()
    stranger = synthetic_photo()
    n = args.samples
    try:
        _, admin = harness.make_user(UserRole.ADMIN)
        visitor_id, visitor = harness.make_user(UserRole.USER)
        harness.gatekeeper_tokens = [harness.make_user(UserRole.GATEKEEPER)[1] for _ in range(GATEKEEPERS)]
        event_id = harness.create_event(admin, "main")
        empty_event_id = harness.create_event(admin, "nobody-enrolled")
        [ticket] = harness.valid_tickets(visitor_id, event_id, 1)
        harness.enroll(visitor, ticket.id, photo)
        qr_tickets = harness.valid_tickets(visitor_id, empty_event_id, n)

        scenarios = [
            Scenario("face_first_entry", "Face, first scan: search + lock + VALID→ENTERED + log"),
            Scenario("face_rescan", "Face, re-scan of the same person: search + lock + ALREADY_ENTERED + log"),
            Scenario("face_unknown", "Face, nobody enrolled for the event: search, NOT_RECOGNIZED + log"),
            Scenario("qr_entry", "QR fallback, first entry of each ticket: lookup + lock + ENTERED + log"),
            Scenario("face_10_parallel", "Face re-scans from 10 gates at once (contention on one ticket row)"),
        ]
        first, rescan, unknown, qr, parallel = scenarios
        harness.face(empty_event_id, stranger)  # warm-up (connections, lazy imports); not counted
        first.samples.append(harness.face(event_id, photo))  # a ticket enters once: one sample
        rescan.samples += [harness.face(event_id, photo) for _ in range(n)]
        unknown.samples += [harness.face(empty_event_id, stranger) for _ in range(n)]
        qr.samples += [harness.qr(empty_event_id, t.qr_token) for t in qr_tickets]
        with ThreadPoolExecutor(max_workers=10) as pool:
            for _ in range(max(1, n // 10)):
                parallel.samples += list(pool.map(lambda _: harness.face(event_id, photo), range(10)))
        return scenarios
    finally:
        harness.cleanup()


def report(scenarios: list[Scenario], args: argparse.Namespace) -> str:
    settings = get_settings()
    lines = [
        "# Gate verification latency",
        "",
        f"Measured {datetime.now(UTC):%Y-%m-%d %H:%M} UTC with `scripts/measure_latency.py` against `{args.base_url}`.",
        f"Face provider: **{settings.face_provider}** · machine: {platform.machine()}, {os.cpu_count()} CPUs, "
        f"{platform.system()} {platform.release()} · Python {platform.python_version()}.",
        f"Target from PROJECT_SPEC: full verification < **{TARGET_MS:.0f} ms**.",
        "",
        "Client = round trip measured by the script (HTTP + server). Server columns come from the",
        "`Server-Timing` header: `face` = face provider search, `db` = locked entry transaction + log.",
        "",
        "| Scenario | n | client p50 | client p95 | client p99 | client max | server face p50 | server db p50 | server total p95 | < 800 ms (p95) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for s in scenarios:
        client = summarize([x.client_ms for x in s.samples])
        face = summarize([x.server["face"] for x in s.samples if "face" in x.server])
        db = summarize([x.server["db"] for x in s.samples if "db" in x.server])
        total = summarize([x.server["total"] for x in s.samples if "total" in x.server])
        ok = "✓" if client and client["p95"] < TARGET_MS else "✗"
        fmt = lambda d, k: f"{d[k]:.1f} ms" if d else "—"  # noqa: E731
        lines.append(
            f"| {s.name} | {int(client['n'])} | {fmt(client, 'p50')} | {fmt(client, 'p95')} | {fmt(client, 'p99')} | "
            f"{fmt(client, 'max')} | {fmt(face, 'p50')} | {fmt(db, 'p50')} | {fmt(total, 'p95')} | {ok} |"
        )
    lines += ["", "Scenarios:", ""] + [f"- **{s.name}**: {s.description}. Results: {sorted({x.result for x in s.samples})}" for s in scenarios]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--photo", help="JPEG/PNG of a real face (needed for FACE_PROVIDER=rekognition)")
    parser.add_argument("--report", help="write the markdown table to this file")
    parser.add_argument("--insecure", action="store_true", help="accept a self-signed HTTPS certificate")
    args = parser.parse_args()

    scenarios = run(args)
    text = report(scenarios, args)
    print(text)
    if args.report:
        Path(args.report).write_text(text, encoding="utf-8")
        print(f"report written to {args.report}")


if __name__ == "__main__":
    main()
