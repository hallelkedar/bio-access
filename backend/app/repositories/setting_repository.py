from sqlalchemy.orm import Session

from app.models.setting import Setting


def get_value(db: Session, key: str) -> str | None:
    setting = db.get(Setting, key)
    return setting.value if setting else None


def set_value(db: Session, key: str, value: str) -> None:
    setting = db.get(Setting, key)
    if setting is None:
        db.add(Setting(key=key, value=value))
    else:
        setting.value = value
    db.flush()
