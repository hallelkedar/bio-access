# BioAccess — Architecture

Diagrams for the project book. They are written in [Mermaid](https://mermaid.js.org/), so they
render on GitHub and in VS Code and stay next to the code; SVG exports are in
[`diagrams/`](diagrams/) (regenerate with `docs/export-diagrams.sh`).

1. [System context](#1-system-context)
2. [Backend layers and provider interfaces](#2-backend-layers-and-provider-interfaces)
3. [Purchase flow](#3-purchase-flow)
4. [Face enrollment flow](#4-face-enrollment-flow)
5. [Gate verification flow](#5-gate-verification-flow)
6. [Ticket state machine](#6-ticket-state-machine)
7. [Data model](#7-data-model)
8. [Docker deployment](#8-docker-deployment)

---

## 1. System context

Who talks to whom. Every external service sits behind an interface with a free fake/console
implementation, selected in `.env`.

```mermaid
flowchart LR
    visitor([Visitor<br/>browser])
    gatekeeper([Gatekeeper<br/>gate laptop + webcam])
    admin([Admin<br/>dashboard])

    subgraph bioaccess[BioAccess]
        web[nginx<br/>React app + TLS]
        api[FastAPI backend]
        db[(PostgreSQL)]
    end

    stripe[Stripe<br/>Checkout + webhooks]
    rekognition[AWS Rekognition<br/>face collections]
    s3[AWS S3<br/>event covers]
    mail[Resend<br/>email]
    sms[Twilio<br/>SMS]

    visitor -->|HTTPS| web
    gatekeeper -->|HTTPS| web
    admin -->|HTTPS + WSS| web
    web -->|/api /ws /media /webhooks| api
    api --> db
    api -->|checkout, session status| stripe
    stripe -->|signed webhook| web
    api -->|detect, index, search| rekognition
    api -->|cover upload| s3
    api -->|ticket + QR| mail
    api -->|confirmation| sms
```

## 2. Backend layers and provider interfaces

Routers only translate HTTP; business rules live in services; SQL lives in repositories.
External services are Strategy/Adapter interfaces with a fake and a real implementation.

```mermaid
flowchart TB
    subgraph api[Routers: app/api]
        r1[auth · events · tickets · payments<br/>enrollment · gate · admin · ws]
    end
    subgraph services[Services: app/services]
        s1[auth · event · ticket · payment<br/>enrollment · access_control · face_search<br/>analytics · notification · storage · settings · realtime]
    end
    subgraph repos[Repositories: app/repositories]
        p1[user · event · ticket · payment<br/>biometric · access_log · setting]
    end
    subgraph providers[Providers: app/providers]
        face[FaceProvider<br/>fake · demo · rekognition]
        pay[PaymentProvider<br/>fake · stripe]
        notify[Notifier<br/>console · resend · twilio]
        store[StorageService<br/>local · s3]
    end
    db[(PostgreSQL)]

    api --> services
    services --> repos
    services --> providers
    repos --> db
```

## 3. Purchase flow

The ticket becomes `VALID` exactly once, whichever arrives first: Stripe's webhook or the
success page's refresh call (for a webhook that never arrives). Both use the same locked,
idempotent code.

```mermaid
sequenceDiagram
    actor V as Visitor
    participant UI as React app
    participant API as Backend
    participant DB as PostgreSQL
    participant S as Stripe
    participant N as Email/SMS

    V->>UI: Buy ticket
    UI->>API: POST /api/tickets
    API->>DB: lock event row, check capacity, insert PENDING_PAYMENT
    UI->>API: POST /api/tickets/{id}/checkout
    API->>S: create Checkout Session
    API->>DB: payments row (CREATED)
    API-->>UI: checkout URL
    UI->>S: redirect, card 4242…
    S-->>UI: redirect to /checkout/success
    par Webhook (normal path)
        S->>API: POST /webhooks/payment (signed)
        API->>API: verify signature
    and Refresh (fallback after 5 s)
        UI->>API: POST /api/tickets/{id}/payment/refresh
        API->>S: get session status
    end
    API->>DB: lock payment + ticket, CREATED→PAID, PENDING→VALID (once)
    API-)N: background task: email with QR + SMS
    UI->>API: GET /api/tickets/me (poll)
    API-->>UI: VALID → "Payment received!"
```

## 4. Face enrollment flow

The photo exists only in memory: it is read from the raw request body (never a temp file),
sent to the provider, and dropped. Only the provider's `face_id` is stored.

```mermaid
sequenceDiagram
    actor V as Visitor
    participant UI as Enrollment page
    participant API as Backend
    participant F as Face provider (Rekognition)
    participant DB as PostgreSQL

    V->>UI: tick consent, take photo (camera stays off until consent)
    UI->>API: POST /api/enrollment?ticket_id&consent=true<br/>body: raw JPEG (in memory)
    API->>API: ticket is mine + VALID, event open, not enrolled, image decodes
    API->>F: check_quality (one face, light, sharpness, pose)
    alt quality problems
        F-->>API: issues
        API-->>UI: 422 + issues → one tip per issue, retake
    else good photo
        API->>F: ensure_collection(event) + IndexFaces(ExternalImageId = ticket_id)
        F-->>API: face_id
        API->>DB: biometric_profiles(ticket_id, face_id, consent_at)
        API-->>UI: 201 → "Face entry is ready!"
    end
```

## 5. Gate verification flow

The slow network call happens before any lock. The entry itself is one short transaction
with `SELECT … FOR UPDATE`, so parallel gates admit a ticket exactly once (tested with 10
threads, and with face and QR mixed).

```mermaid
sequenceDiagram
    participant G as Gate terminal
    participant API as Backend
    participant F as Face provider
    participant DB as PostgreSQL
    participant WS as Admin dashboards

    G->>G: motion detected (32×18 thumbnails), one request at a time
    G->>API: POST /api/gate/verify (raw JPEG frame)
    API->>API: event ACTIVE and inside time window?
    API->>F: search(event collection, frame, threshold)
    F-->>API: ticket_id + similarity, or no match
    rect rgb(235, 245, 255)
    note over API,DB: one transaction
    API->>DB: SELECT ticket … FOR UPDATE
    API->>API: re-check status under the lock
    API->>DB: VALID → ENTERED, insert access_log
    end
    API-->>G: APPROVED (name) / DENIED (reason)
    API-)WS: background: access_event over WebSocket
    note over G: Face service down → PROVIDER_ERROR → QR fallback,<br/>same attempt_entry() with method = QR
```

## 6. Ticket state machine

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT: buy (seat reserved)
    PENDING_PAYMENT --> VALID: payment confirmed<br/>(webhook or refresh)
    PENDING_PAYMENT --> CANCELLED: payment failed / expired<br/>(no other open checkout)
    CANCELLED --> PENDING_PAYMENT: buy again (new QR token)
    VALID --> ENTERED: approved at the gate (face or QR)
    ENTERED --> ENTERED: re-scan → ALREADY_ENTERED
    ENTERED --> [*]
```

## 7. Data model

No column can hold an image or a face vector (checked by `test_case_10`): faces are only
referenced by the provider's `face_id`.

```mermaid
erDiagram
    users ||--o{ tickets : buys
    users ||--o{ events : creates
    events ||--o{ tickets : has
    tickets ||--o{ payments : "paid by"
    tickets ||--o| biometric_profiles : "face for"
    tickets ||--o{ access_logs : "scanned as"
    events ||--o{ access_logs : at

    users {
        int id PK
        string email UK
        string full_name
        string phone "E.164, optional"
        string password_hash "bcrypt"
        enum role "USER | GATEKEEPER | ADMIN"
        datetime created_at
    }
    events {
        int id PK
        string name
        string location
        string cover_image_url
        datetime starts_at
        datetime ends_at
        int capacity
        int price_cents
        string currency
        enum status "DRAFT | ACTIVE | CLOSED"
        string face_collection_id
        int created_by FK
    }
    tickets {
        int id PK
        int event_id FK
        int user_id FK "unique with event_id"
        string qr_token UK "256-bit random"
        enum status "PENDING_PAYMENT | VALID | ENTERED | CANCELLED"
        datetime purchased_at
        datetime entered_at
    }
    payments {
        int id PK
        int ticket_id FK
        string provider
        string provider_session_id UK
        string provider_event_id UK "idempotency"
        int amount_cents
        string currency
        enum status "CREATED | PAID | FAILED | REFUNDED"
        datetime created_at
    }
    biometric_profiles {
        int id PK
        int ticket_id FK "unique"
        string face_id "provider reference only"
        string collection_id
        datetime consent_at
        datetime created_at
    }
    access_logs {
        int id PK
        int ticket_id FK "null if unrecognized"
        int event_id FK
        string gate_id
        datetime timestamp
        enum result "APPROVED | DENIED"
        enum reason
        float similarity
        enum method "FACE | QR"
    }
    settings {
        string key PK
        string value
    }
```

## 8. Docker deployment

Only nginx is published. The backend trusts nginx's forwarded headers (it can't be reached
otherwise), so rate limits see the real client IP. Secrets are passed at runtime from `.env`,
never baked into images.

```mermaid
flowchart LR
    browser([Browsers<br/>https://localhost or LAN IP])

    subgraph host[Docker host]
        subgraph net[compose network]
            web["web: nginx<br/>:443 TLS, :80 → 301<br/>React app, CSP, camera=(self)"]
            backend["backend: uvicorn<br/>non-root, alembic on start<br/>no published port"]
            db[(db: postgres:15)]
        end
        certs[[./certs<br/>mkcert]]
        env[[.env<br/>runtime secrets]]
        vols[(volumes:<br/>pgdata · media · demo-data)]
    end

    browser -->|443| web
    web -->|/api /ws /media /webhooks| backend
    backend --> db
    certs -.-> web
    env -.-> backend
    vols -.-> db
    vols -.-> backend
```
