# BioAccess — Project Specification (v2, cloud services)

> For Claude Code / Cursor. Read this file and BUILD_PLAN.md before generating code. Follow the architecture and rules below. Work in small steps, one BUILD_PLAN step at a time. If something is ambiguous, ask.

## 1. Overview

**BioAccess** — real-time biometric ticketing and access-control system.

- A user buys a ticket (real payment provider, test mode) and receives it by email/SMS with a QR code.
- The user does a one-time **face enrollment** with a webcam. The image is sent over TLS to a **cloud face-recognition API (AWS Rekognition)**, which stores only a face vector inside a per-event *collection*. **Our system never stores the raw image** (not on disk, not in DB, not in logs).
- On event day a **Gate Terminal** (browser + webcam) sends frames to our API. The API asks the face provider to search the event's collection, validates the ticket, and blocks double entry (**Anti-Passback**) inside an ACID transaction. The gate shows green/red visual + audio feedback.
- Every attempt is written to an **Audit Log**. The Admin dashboard receives live updates over WebSockets.
- After the event closes, biometric data is deleted from the collection.

**Goals:** entry < 1 second (target: full verification < 800 ms, to be measured), anti-fraud (1:1 binding ticket ↔ face), real-time Anti-Passback across gates, privacy by design, no special hardware.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), TypeScript, React Router, Axios, Tailwind CSS, lucide-react |
| Backend | Python 3.11+, FastAPI, Uvicorn, Pydantic v2 + pydantic-settings, SQLAlchemy 2.x + Alembic, python-jose (JWT), passlib[bcrypt], slowapi, httpx |
| Database | PostgreSQL 15+ |
| Realtime | FastAPI WebSockets (WSS) |
| **Face recognition (cloud)** | **AWS Rekognition** via `boto3` (Collections, IndexFaces, SearchFacesByImage, DetectFaces). Alternatives: Azure Face (needs Limited Access approval), Face++, Luxand |
| **Payments** | **Stripe (test mode)** or PayPal Sandbox / Israeli gateway with test environment |
| **Email** | Resend or SendGrid |
| **SMS** | Twilio (trial: verified numbers only) |
| **Storage** | AWS S3 (event images, QR images). Never face images |
| Local libs | `qrcode[pil]` for QR generation; Pillow for basic image validation |
| Infra | Docker + docker-compose; HTTPS locally (mkcert) — required for webcam access; ngrok/Cloudflare Tunnel for payment webhooks in dev |
| Tests | pytest, pytest-asyncio, httpx; Vitest + React Testing Library; optional Playwright |

## 3. Architecture

**Layered 3-Tier, service-oriented:** Presentation → Services (business logic) → Repositories (data access). Every external service sits behind an **interface** with a **fake** implementation (tests/dev) and a **real** implementation, selected by `.env`.

```mermaid
flowchart LR
  subgraph Client["Client Tier (Browser)"]
    U[User App]
    G[Gate Terminal]
    A[Admin Dashboard]
  end
  subgraph App["Application Tier (FastAPI)"]
    API[REST API + Auth/RBAC + Rate limit]
    WS[WebSocket Manager]
    SVC[Services: Auth / Events / Tickets / Payments / Enrollment / AccessControl / Analytics / Notifications]
  end
  DB[(PostgreSQL)]
  subgraph Ext["External Services"]
    REK[AWS Rekognition]
    PAY[Stripe / PayPal]
    MAIL[Email provider]
    SMS[Twilio]
    S3[S3]
  end
  U & G & A -- HTTPS/WSS --> API
  API --> SVC
  SVC --> DB
  SVC --> REK
  SVC --> PAY
  SVC --> MAIL
  SVC --> SMS
  SVC --> S3
  PAY -. webhook .-> API
  SVC --> WS -. live .-> A
```

### Design patterns (only where natural)
- **Repository** — all DB access.
- **Service layer** — business logic only here.
- **Strategy / Adapter** — `FaceProvider`, `PaymentProvider`, `Notifier`, `StorageService` interfaces; fake + real adapters.
- **Dependency Injection** — FastAPI `Depends`.
- **Observer / Pub-Sub** — WebSocket manager broadcasts access events.
- **Unit of Work** — one DB transaction per access attempt.
- **Idempotency** — payment webhook handled idempotently.

### Architectural alternatives (for the project book)
1. **Cloud face API (CHOSEN)** — accurate, no model hosting, fast to build. Cons: network latency, cost, biometric image leaves our server (TLS), vendor dependency.
2. Local model (DeepFace / face_recognition) — full control and privacy, heavier server, needs tuning.
3. Client-side embedding (WASM) — less bandwidth, but client can be spoofed.

Race-condition alternatives: **(A, chosen)** `SELECT ... FOR UPDATE`; **(B)** Redis atomic operations.

## 4. Repository Structure

```
bioaccess/
├── CLAUDE.md
├── PROJECT_SPEC.md
├── BUILD_PLAN.md
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/        # config.py, security.py, deps.py, rate_limit.py
│   │   ├── db/          # session.py, base.py, migrations/ (Alembic)
│   │   ├── models/      # user, event, ticket, biometric_profile, access_log, setting
│   │   ├── schemas/
│   │   ├── repositories/
│   │   ├── services/    # auth, event, ticket, payment, notification, storage, enrollment, access_control, analytics
│   │   ├── providers/
│   │   │   ├── face/        # base.py, fake.py, rekognition.py
│   │   │   ├── payment/     # base.py, fake.py, stripe_provider.py
│   │   │   ├── notify/      # base.py, console.py, email_resend.py, sms_twilio.py
│   │   │   └── storage/     # base.py, local_fake.py, s3.py
│   │   ├── api/         # routes_auth, events, tickets, payments(+webhook), enrollment, gate, admin, ws
│   │   └── utils/       # image_validation.py, qr.py
│   ├── tests/{unit,integration}
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/
    └── src/{api,auth,pages/{user,gate,admin},components,hooks}
```

## 5. Modules
1. **Auth & Users** — register/login, JWT, RBAC (`USER`, `GATEKEEPER`, `ADMIN`).
2. **Events & Tickets** — event CRUD, catalog, ticket lifecycle.
3. **Payments** — checkout creation, signed webhook, idempotent ticket activation.
4. **Notifications** — email + SMS with QR after payment; failures never break the purchase.
5. **Face Provider layer** — quality check, enroll, search, delete (interface + fake + Rekognition).
6. **Access Control & Anti-Passback** — atomic entry transaction.
7. **Logs & Analytics** — audit log, entries per 30 min, breakdown, occupancy.

## 6. Ticket lifecycle

```
PENDING_PAYMENT --(payment webhook OK)--> VALID --(approved entry)--> ENTERED
        \--(payment failed/expired)--> CANCELLED      VALID --(admin/user cancel)--> CANCELLED
```
Enrollment is allowed only for tickets in `VALID`. Gate entry is allowed only for `VALID`.

## 7. Database Schema (PostgreSQL)

```sql
users(id PK, email UNIQUE, full_name, phone NULL, password_hash, role ENUM('USER','GATEKEEPER','ADMIN'), created_at)

events(id PK, name, location, cover_image_url NULL, starts_at, ends_at, capacity, price_cents, currency,
       status ENUM('DRAFT','ACTIVE','CLOSED'), face_collection_id NULL, created_by FK users)

tickets(id PK, event_id FK, user_id FK, qr_token UNIQUE, status ENUM('PENDING_PAYMENT','VALID','ENTERED','CANCELLED'),
        purchased_at, entered_at NULL, UNIQUE(event_id, user_id))

payments(id PK, ticket_id FK, provider, provider_session_id UNIQUE, provider_event_id UNIQUE NULL,
         amount_cents, currency, status ENUM('CREATED','PAID','FAILED','REFUNDED'), created_at)

biometric_profiles(id PK, ticket_id FK UNIQUE, face_id, collection_id, consent_at, created_at)
   -- NO image, NO raw vector stored by us

access_logs(id PK, ticket_id FK NULL, event_id FK, gate_id, timestamp, result ENUM('APPROVED','DENIED'),
            reason ENUM('NONE','NOT_RECOGNIZED','ALREADY_ENTERED','EVENT_NOT_ACTIVE','LIVENESS_FAILED','CANCELLED','LOW_QUALITY','PROVIDER_ERROR'),
            similarity FLOAT NULL, method ENUM('FACE','QR'))

settings(key PK, value)   -- e.g. face_match_threshold (similarity %, default 95)
```

Indexes: `tickets(event_id, status)`, `access_logs(event_id, timestamp)`, `payments(provider_session_id)`.

Face data is bound to the **ticket** (collection per event, `ExternalImageId = ticket_id`).

## 8. REST API

JSON, `Authorization: Bearer <JWT>`. Errors: 401, 403, 409 (conflict), 422, 429.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | public | Account + JWT |
| GET | `/api/events` | USER+ | Active events |
| POST/PUT/DELETE | `/api/events[/{id}]` | ADMIN | Event CRUD (activating creates face collection) |
| POST | `/api/events/{id}/cover` | ADMIN | Upload cover image → S3 |
| POST | `/api/tickets` | USER | Create `PENDING_PAYMENT` ticket |
| POST | `/api/tickets/{id}/checkout` | USER | Returns payment checkout URL |
| POST | `/webhooks/payment` | provider (signature) | Marks payment PAID, ticket VALID, triggers notifications |
| GET | `/api/tickets/me` | USER | My tickets |
| POST | `/api/enrollment` | USER | Consent + image → quality check → enroll; image discarded |
| POST | `/api/gate/verify` | GATEKEEPER | `{event_id, frames[]}` → `{result, reason, user_name?, similarity}` |
| POST | `/api/gate/verify-qr` | GATEKEEPER | Fallback `{event_id, qr_token}` |
| GET | `/api/admin/stats/{event_id}` | ADMIN | 30-min buckets, breakdown, occupancy |
| GET | `/api/admin/logs` | ADMIN | Filterable audit logs |
| GET/PUT | `/api/admin/settings` | ADMIN | Threshold |
| GET | `/api/admin/users` | ADMIN | Users |
| POST | `/api/admin/events/{id}/purge-biometrics` | ADMIN | Delete event collection |

WebSocket: `WS /ws/admin?token=...` → `{type:"access_event"|"stats_update", payload}`. Validate every message with Pydantic.

## 9. Main Flows

### 9.1 Purchase
Create ticket (`PENDING_PAYMENT`) → checkout URL → user pays on provider page → provider calls `/webhooks/payment` → verify signature, idempotency check, ticket `VALID` → background task: generate QR, send email + SMS.

### 9.2 Enrollment
User consents (checkbox, stored as `consent_at`) → camera modal → `POST /api/enrollment` → validate file (MIME/size/decodes) → `FaceProvider.check_quality` (exactly one face, brightness/sharpness thresholds) → `FaceProvider.enroll(event, ticket, image)` → save `face_id` → image bytes dropped from memory (never written to disk or logs).

### 9.3 Gate verification (core sequence)

```mermaid
sequenceDiagram
  participant G as Gate Terminal
  participant API as FastAPI /gate/verify
  participant FP as FaceProvider (Rekognition)
  participant AC as AccessControlService
  participant DB as PostgreSQL
  participant WS as WS Manager
  participant AD as Admin Dashboard

  G->>API: frames[] + event_id (JWT)
  API->>API: auth, role, rate limit, validate image
  API->>FP: liveness check (basic multi-frame)
  API->>FP: search(event collection, best frame, threshold)
  FP-->>API: ticket_id + similarity | none
  API->>AC: attempt_entry(event_id, ticket_id, similarity)
  AC->>DB: BEGIN; SELECT ticket FOR UPDATE
  alt VALID and event active
    AC->>DB: ticket -> ENTERED; INSERT access_log(APPROVED); COMMIT
  else
    AC->>DB: INSERT access_log(DENIED, reason); COMMIT
  end
  AC-->>API: result
  API-->>G: JSON (green/red + sound)
  AC->>WS: publish access_event
  WS-->>AD: live update
```

Provider errors/timeouts → `DENIED(PROVIDER_ERROR)` + UI suggests QR fallback.

## 10. Face recognition details
- Similarity-based (Rekognition `FaceMatchThreshold`, 0–100). Default 95, editable in Admin (`settings.face_match_threshold`). Tune using real tests (false accept vs false reject).
- One collection per event: `bioaccess-event-{id}`; created on event activation, deleted on close/purge.
- Quality gate before enrollment (`DetectFaces`: single face, confidence, brightness, sharpness, pose).
- Liveness: start with basic multi-frame motion check; optionally later Rekognition Face Liveness (requires its own client widget). **Document as a known limitation.**
- Borderline similarity → require QR as second factor.
- Latency budget: client compresses frames (e.g. 480 px, JPEG/WebP), one in-flight request per gate; measure and record real numbers.

## 11. Reliability & Recovery
- Entry = one ACID transaction; failure → `ROLLBACK`.
- PostgreSQL WAL for crash recovery.
- Webhook idempotency via unique `provider_event_id`.
- Notifications/failures logged, never fail the purchase; retries optional.
- Graceful shutdown in FastAPI `lifespan`; Docker `restart: unless-stopped`.
- Face-provider outage → QR fallback.

## 12. Security & Privacy

- **Biometric privacy:** no raw images stored by us; only `face_id` references; the image goes to AWS over TLS for processing; vectors live in the event collection and are deleted after the event. Explicit user consent stored with timestamp. Be careful claiming vectors are "impossible to reconstruct" — say "not designed to be reversible".
- HTTPS/WSS only. JWT with short expiry + RBAC.
- bcrypt for passwords; ORM/parameterized queries; Pydantic validation everywhere.
- Upload validation (MIME, size, decodes as image).
- Rate limiting (slowapi) on auth and gate routes; CORS allow-list.
- Webhook signature verification; secrets only in `.env`; least-privilege IAM user (Rekognition + specific S3 bucket only).
- Billing alarm on AWS; test/sandbox modes for payment, SMS, email.

| # | Scenario | Response |
|---|---|---|
| 1 | Re-scan of used ticket | Deny `ALREADY_ENTERED`, red screen, logged |
| 2 | Spoof with phone photo | Liveness check fails → deny |
| 3 | API call without token | 401 |
| 4 | Regular user on Admin route | 403 |
| 5 | SQL injection attempt | ORM + parameterized queries |
| 6 | Malicious file upload | MIME/size/decode validation, reject |
| 7 | Entry outside event time | Deny `EVENT_NOT_ACTIVE` |
| 8 | Two gates, same ticket, simultaneously | `SELECT FOR UPDATE`, exactly one approved |
| 9 | Flooding / brute force | Rate limit 429 |
| 10 | DB leak | No images, no raw vectors, hashed passwords |
| 11 | Forged payment webhook | Signature check fails → 400 |
| 12 | Same webhook delivered twice | Idempotent, no duplicate effect |
| 13 | Face provider down | `PROVIDER_ERROR`, QR fallback |
| 14 | Leaked API key | Keys only in `.env`, least privilege, rotate |

## 13. Frontend Screens
- **User:** login/register, events catalog, buy → checkout redirect → result page, my tickets (QR), enrollment (consent + camera + quality feedback).
- **Gate Terminal:** event selection, live video, throttled auto-scan, big green/red overlay, audio cue, manual QR fallback.
- **Admin:** events CRUD (+cover upload), live entries feed, charts (30-min entries, approved vs denied by reason, occupancy), threshold control, logs table with filters, users, purge-biometrics button.
- Responsive, role-based route guards, loading/error states.

## 14. Analytics
Entries per 30-minute bucket; approved/denied breakdown by reason; occupancy = `ENTERED / VALID+ENTERED tickets`.

## 15. Configuration (`.env.example`)
```
DATABASE_URL=postgresql+psycopg://bioaccess:bioaccess@localhost:5432/bioaccess
JWT_SECRET=change-me
JWT_EXPIRE_MINUTES=60
CORS_ORIGINS=https://localhost:5173
RATE_LIMIT_PER_MINUTE=60
MAX_UPLOAD_MB=2

FACE_PROVIDER=fake            # fake | rekognition
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
FACE_MATCH_THRESHOLD=95

PAYMENT_PROVIDER=fake         # fake | stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

NOTIFIER=console              # console | resend+twilio
RESEND_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=

STORAGE_PROVIDER=local        # local | s3
S3_BUCKET=
```

## 16. Testing Plan

**Unit tests**

| Module | Test | Expected |
|---|---|---|
| security | hash/verify password | correct true, wrong false |
| security | JWT create/decode/expired | expired rejected |
| deps | wrong role | 403 |
| ticket_service | duplicate ticket for event | error |
| ticket_service | sold-out event | error |
| payment_service | valid webhook | ticket VALID |
| payment_service | same webhook twice | one effect |
| payment_service | bad signature | rejected |
| access_control | VALID ticket | ENTERED + APPROVED log |
| access_control | ENTERED ticket | DENIED ALREADY_ENTERED |
| access_control | outside time window | DENIED EVENT_NOT_ACTIVE |
| face (fake) | enroll then search | match |
| face (fake) | unknown face | no match |
| image_validation | non-image / oversize | rejected |
| analytics | 30-min bucketing | correct counts |
| notifier | provider failure | logged, no exception |

**Full-flow tests (with fake providers; a small manual run with real ones)**

| Flow | Expected |
|---|---|
| Register → buy → pay (fake) → email logged → enroll → gate verify | Approved, ENTERED, log row, admin WS event |
| Second scan same ticket | Denied ALREADY_ENTERED |
| 10 parallel verifies same ticket | Exactly one approved |
| Static photo frames | Denied LIVENESS_FAILED |
| Provider down → QR | Approved via QR, `method=QR` |
| Non-admin on admin API | 403 |
| Threshold changed | Used by next verification |
| Event purge | Collection deleted, enrollment no longer matches |

**Manual real-service checklist:** real Rekognition match/non-match, Stripe test card payment, real webhook through tunnel, real email and SMS delivery.

## 17. Project Book Placeholders (fill manually)
Project location, advisor details, hours/team split, equipment, software, new knowledge (SQLAlchemy, Alembic, FastAPI DI, JWT, webhooks, AWS Rekognition), bibliography, work plan, version control (Git branches `main`/`dev`/feature, commit conventions).

## 18. Coding Rules
1. Routers → services → repositories. No business logic in routers.
2. Type hints everywhere; Pydantic schemas for all I/O.
3. Never store or log raw face images or tokens/keys.
4. Secrets from environment only; `.env` in `.gitignore`.
5. Every external service behind an interface with a fake; default `.env` uses fakes.
6. Every new service function gets a unit test.
7. Small steps: follow BUILD_PLAN.md, explain the plan first, one commit per step.
8. Ask before adding dependencies.