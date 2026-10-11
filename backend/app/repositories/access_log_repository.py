from sqlalchemy.orm import Session

from app.models.access_log import AccessLog


def create(db: Session, log: AccessLog) -> AccessLog:
    db.add(log)
    db.flush()
    return log
