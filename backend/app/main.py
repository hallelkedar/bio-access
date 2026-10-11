from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import events, payments, routes_auth, tickets
from app.core.config import get_settings
from app.db.session import get_db

app = FastAPI(title="BioAccess")
app.include_router(routes_auth.router)
app.include_router(events.router)
app.include_router(tickets.router)
app.include_router(payments.router)

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
