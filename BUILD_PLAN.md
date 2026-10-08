# BioAccess — Build Plan with Claude Code (small steps, full control)

## Part A — Required technologies

### Core (already in PROJECT_SPEC.md)
Python 3.11, FastAPI, Uvicorn, SQLAlchemy 2 + Alembic, PostgreSQL, Pydantic, JWT (python-jose), bcrypt, WebSockets, React + TypeScript + Vite, Tailwind, Axios, Docker Compose, pytest, Vitest, Git/GitHub.

### Real external services (recommended choice first)

| Need | Recommended | Alternatives | Notes |
|---|---|---|---|
| **Cloud face recognition** | **AWS Rekognition** (DetectFaces, IndexFaces, SearchFacesByImage, optional Face Liveness) | Azure Face (identification requires Microsoft "Limited Access" approval), Face++, Luxand.cloud | Replaces local embeddings. Rekognition keeps face vectors in a *Collection* and returns a similarity score 0–100. |
| **Email** | **Resend** or SendGrid | Gmail SMTP (dev only) | Domain verification needed for production sending; sandbox/test sender is fine for the project. |
| **SMS** | **Twilio** | Israeli providers (e.g. Inforu, Vonage) | Trial accounts only send to verified numbers; enough for demo. |
| **Payments** | **Stripe test mode** *if your account can be opened*; otherwise **PayPal Sandbox** | Israeli gateways with test environments (e.g. Cardcom, PayPlus, Tranzila) | Check Stripe availability for your country/business status first. Test mode = fake cards, no real money. |
| **File storage** | **AWS S3** (same AWS account) | Cloudinary, Cloudflare R2 | Event cover images, ticket QR images/PDF. **Never store face images.** |
| **Public URL for webhooks (dev)** | ngrok or Cloudflare Tunnel | — | Payment provider must reach your local `/webhooks/payment`. |

### Extra libraries
`boto3` (AWS), `httpx` (HTTP calls), `qrcode[pil]` (QR generation — local lib, fine), `slowapi` (rate limiting), `pydantic-settings`, `python-multipart`, `stripe` or PayPal SDK, `twilio`, `resend`.

### ⚠️ Architecture changes caused by using a cloud face API
1. **Images DO leave your server** (sent to AWS for a moment). Update the project book: "image is sent over TLS to Rekognition for feature extraction; the app never stores it; Rekognition stores only a face vector in a collection."
2. **DB change:** `biometric_profiles` stores `face_id` (Rekognition FaceId) + `collection_id` instead of a float array. Use **one collection per event**, enroll **per ticket**, `ExternalImageId = ticket_id`.
3. **Threshold:** becomes `FaceMatchThreshold` (similarity %, e.g. 95–99). Admin slider changes this value.
4. **Latency:** network call ~200–500 ms; budget of 800 ms is still realistic, but measure it.
5. **Ticket status** gains `PENDING_PAYMENT` → `VALID` → `ENTERED` / `CANCELLED`.
6. Keep a `FaceProvider` interface so you can ALSO keep a fake provider for tests (no AWS costs, no network).

---

## Part B — How to work with Claude Code (rules that keep you in control)

1. **One step = one prompt = one commit.** Never paste two steps together.
2. Start every step with: *"Explain your plan in 3–5 bullets first, wait for my OK."* (or use Plan mode: Shift+Tab).
3. End every step with: *"Explain what each new function does in simple terms, and give me one command to verify it works."*
4. Run the verification yourself. Read the diff (`git diff`) before committing.
5. Put `PROJECT_SPEC.md` + this file in the repo and create `CLAUDE.md` containing: *"Read PROJECT_SPEC.md. Layers: router → service → repository. No business logic in routers. Never store raw face images. Secrets only from .env. Make small changes; ask before adding new dependencies."*
6. If you don't understand something: *"Explain this file line by line, then quiz me with 3 questions."*
7. Always develop against **fake providers first**, then plug in the real service. Each external service gets: interface → fake implementation → real implementation → switch via `.env`.

---

## Part C — Step-by-step plan

Format: **Step — goal** · *Prompt to Claude Code* · ✅ how you verify.

### Phase 0 — Setup
**0.1 Repo skeleton** · *"Create folders per PROJECT_SPEC section 4 (empty files only), a .gitignore for Python/Node/.env, and CLAUDE.md as described. No code yet."* · ✅ `git status`, first commit.
**0.2 Database in Docker** · *"Create docker-compose.yml with only PostgreSQL 15 and a named volume, and .env.example."* · ✅ `docker compose up -d` then connect with `psql`.
**0.3 Minimal API** · *"Create backend with FastAPI, requirements.txt, and a GET /health returning {status: ok}."* · ✅ open `/docs`, call `/health`.
**0.4 Settings** · *"Add core/config.py using pydantic-settings that reads .env (DATABASE_URL, JWT_SECRET...)."* · ✅ print settings in a tiny script; missing var raises an error.

### Phase 1 — Database
**1.1 Session + Base** · *"Add SQLAlchemy engine, SessionLocal, Base, and a get_db dependency."* · ✅ endpoint `/health/db` runs `SELECT 1`.
**1.2 User model** · *"Add User model (id, email unique, full_name, password_hash, role enum, created_at)."* · ✅ read the model, explain each column to yourself.
**1.3 Alembic** · *"Set up Alembic and generate the first migration for User."* · ✅ `alembic upgrade head`, see table in psql.
**1.4 Event + Ticket models** · *"Add Event and Ticket models (ticket status: PENDING_PAYMENT, VALID, ENTERED, CANCELLED; unique(event_id,user_id)) and a migration."* · ✅ migration applies.
**1.5 Remaining models** · *"Add BiometricProfile (ticket_id, face_id, collection_id, created_at), AccessLog, Setting, with a migration."* · ✅ tables exist.

### Phase 2 — Authentication
**2.1 Password hashing** · *"Add security.py with hash_password/verify_password (bcrypt) and unit tests."* · ✅ `pytest`.
**2.2 Register** · *"Add schemas, user repository, auth service and POST /api/auth/register (email unique, validation)."* · ✅ register twice → second gets 409.
**2.3 Login + JWT** · *"Add POST /api/auth/login returning a JWT with user id and role, expiry from settings."* · ✅ decode token on jwt.io.
**2.4 Auth dependencies** · *"Add get_current_user and require_role(...) dependencies. Add a test route per role."* · ✅ no token → 401, wrong role → 403.
**2.5 Create first admin** · *"Add a CLI script to create an admin user."* · ✅ log in as admin.

### Phase 3 — Events and tickets (no payment yet)
**3.1 Event CRUD (admin)** · *"Add event repository, service, and admin-only routes."* · ✅ test all roles in `/docs`.
**3.2 Catalog** · *"Add GET /api/events for ACTIVE events."* · ✅ draft events don't appear.
**3.3 Ticket creation as PENDING_PAYMENT** · *"Add POST /api/tickets creating a PENDING_PAYMENT ticket; reject duplicates and sold-out events."* · ✅ duplicate → error.
**3.4 My tickets** · *"Add GET /api/tickets/me."* · ✅ only own tickets.

### Phase 4 — Real payment (Stripe test mode / PayPal Sandbox)
**4.1 Account + keys** · Create test account yourself; put keys in `.env` (never in code). · ✅ keys not in git.
**4.2 Interface + fake** · *"Create PaymentProvider interface (create_checkout, parse_webhook) and a FakePaymentProvider."* · ✅ unit test with fake.
**4.3 Checkout endpoint** · *"Add POST /api/tickets/{id}/checkout that returns a checkout URL via the provider."* · ✅ with fake, returns a fake URL.
**4.4 Real provider** · *"Implement the real provider using the official SDK, selected by PAYMENT_PROVIDER in .env."* · ✅ open the checkout page, pay with the provider's test card.
**4.5 Webhook** · Run ngrok/Cloudflare Tunnel. *"Add POST /webhooks/payment that verifies the signature, is idempotent (same event twice = one effect), and sets ticket to VALID."* · ✅ pay → ticket becomes VALID; replay webhook → no change; bad signature → 400.

### Phase 5 — Email, SMS, storage
**5.1 Notification interface** · *"Create NotificationService interface with send_email and send_sms, plus a ConsoleNotifier that prints."* · ✅ buy ticket → message printed.
**5.2 QR generation** · *"Generate a QR PNG for ticket.qr_code (random unguessable token)."* · ✅ scan with your phone.
**5.3 Real email** · *"Implement email sending via Resend (or SendGrid) with the QR attached/linked; failures logged, not crashing the request."* · ✅ receive email.
**5.4 Real SMS** · *"Implement SMS via Twilio sending a short confirmation."* · ✅ receive SMS on verified number.
**5.5 Trigger on payment** · *"After the webhook marks VALID, send email + SMS using FastAPI BackgroundTasks."* · ✅ end-to-end purchase.
**5.6 S3 storage** · *"Add a StorageService (upload event cover image, return URL) with S3 implementation; validate MIME and size."* · ✅ image visible via URL. (Face images are never uploaded here.)

### Phase 6 — Cloud face recognition (AWS Rekognition)
**6.1 Interface + fake** · *"Create FaceProvider interface: ensure_collection(event_id), check_quality(image), enroll(event_id, ticket_id, image)->face_id, search(event_id, image)->(ticket_id, similarity)|None, delete(face_id). Add an in-memory FakeFaceProvider."* · ✅ unit tests with fake.
**6.2 AWS setup** · In AWS: create IAM user with only Rekognition permissions, choose region, put keys in `.env`. · ✅ `aws sts get-caller-identity`.
**6.3 Collections** · *"Implement ensure_collection with boto3 (collection id = bioaccess-event-{id}), create it when an event becomes ACTIVE."* · ✅ list collections in console.
**6.4 Quality check** · *"Implement check_quality using DetectFaces: exactly one face, confidence/brightness/sharpness minimums."* · ✅ try a blurry and a two-face photo.
**6.5 Enrollment** · *"Add POST /api/enrollment: validate file, only for VALID ticket, call enroll (IndexFaces), save face_id, make sure the image bytes are not written anywhere."* · ✅ row in biometric_profiles; no image file on disk.
**6.6 Search** · *"Implement search with SearchFacesByImage using threshold from settings; map ExternalImageId to ticket_id."* · ✅ enrolled person matches, a stranger does not.
**6.7 Liveness (optional, stage 2)** · Start with the basic multi-frame check; consider Rekognition Face Liveness later (it needs its own client widget). · ✅ static photo rejected.
**6.8 Delete biometric data** · *"Add a delete endpoint/job that removes faces from the collection after the event closes."* · ✅ face gone from collection (good privacy argument for the book).

### Phase 7 — Access control (the heart of the project)
**7.1 Verify without locking** · *"Add POST /api/gate/verify (GATEKEEPER): runs search, loads ticket, returns approved/denied with reason. No status change yet."* · ✅ responses for all reasons.
**7.2 Atomic entry** · *"In AccessControlService wrap the check in one transaction with SELECT ... FOR UPDATE, set ENTERED, insert AccessLog; rollback on error."* · ✅ second scan → ALREADY_ENTERED.
**7.3 Concurrency test** · *"Write a test firing 10 parallel verifies for one ticket; exactly one must be approved."* · ✅ test passes; try removing the lock and watch it fail (you'll understand why it matters).
**7.4 Time window** · *"Deny if the event is not ACTIVE or now is outside start/end."* · ✅ unit tests.
**7.5 QR fallback** · *"Add POST /api/gate/verify-qr using the same atomic transaction."* · ✅ logged with method=QR.
**7.6 Async log queue (optional)** · only if you need it for latency; keep the entry update itself synchronous.

### Phase 8 — Real time
**8.1 WS manager** · *"Add ConnectionManager and /ws/admin with JWT check."* · ✅ connect with a small test client.
**8.2 Broadcast access events** · *"After each verification publish an access_event message validated by a Pydantic schema."* · ✅ see messages live.

### Phase 9 — Admin APIs & analytics
**9.1 Logs** · paginated, filterable `GET /api/admin/logs`. ✅
**9.2 Stats** · entries per 30 minutes, approved/denied by reason, occupancy %. ✅ unit test on bucket logic.
**9.3 Settings** · GET/PUT threshold (similarity). ✅ new value affects next search.
**9.4 Users list** · admin only. ✅

### Phase 10 — Security hardening
**10.1 Rate limiting** (`slowapi`) on auth and gate routes ✅ 429.
**10.2 CORS + security headers** ✅ foreign origin blocked.
**10.3 Upload validation** (MIME, size, decodes as image) ✅ malicious file rejected.
**10.4 Walk the 10-case table** from PROJECT_SPEC §12 and write one test per case.

### Phase 11 — Frontend (one screen per step)
**11.1** Vite + React + TS + Tailwind + Router, Axios client with JWT interceptor.
**11.2** Auth context, login/register pages, role-based ProtectedRoute.
**11.3** Events catalog + buy ticket → redirect to checkout → return page.
**11.4** My tickets with QR.
**11.5** `useCamera` hook + Camera component (permissions, errors).
**11.6** Enrollment page (capture → quality feedback → upload).
**11.7** Gate Terminal: scan loop (throttled, e.g. 1 request at a time), green/red overlay, audio, QR fallback button.
**11.8** Admin: events CRUD, logs table, charts, threshold slider, live feed via WebSocket.
For each: *"Build only this page; use existing API client; no new libraries without asking."* ✅ manual click-through.

### Phase 12 — Finish
**12.1** Full-flow test (register → buy → pay (fake) → enroll (fake) → verify → admin sees WS event).
**12.2** Dockerfiles + full docker-compose (db, backend, frontend), HTTPS locally (mkcert) for camera access.
**12.3** README, `.env.example`, architecture diagrams exported for the project book.
**12.4** Measure latency of `/gate/verify` and record numbers for the book.

---

## Part D — Cost & safety checklist
- AWS: set a **billing alarm** and delete test collections when done; check current free-tier terms before starting.
- Use **test/sandbox modes** everywhere (payments, SMS, email).
- Never commit `.env`; rotate any key that leaked.
- Biometric data of real people: use only team/friends who consent for the demo.