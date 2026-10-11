from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import admin, enrollment, events, gate, payments, routes_auth, tickets, ws
from app.core.config import get_settings
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.db.session import get_db

app = FastAPI(title="BioAccess")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.include_router(routes_auth.router)
app.include_router(events.router)
app.include_router(tickets.router)
app.include_router(payments.router)
app.include_router(enrollment.router)
app.include_router(gate.router)
app.include_router(ws.router)
app.include_router(admin.router)

settings = get_settings()
if settings.storage_provider == "local":
    # Serves uploaded event covers in dev; S3 serves them directly in production.
    app.mount("/media", StaticFiles(directory=settings.local_media_dir, check_dir=False), name="media")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ok"}
