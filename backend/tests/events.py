from datetime import UTC, datetime, timedelta


def live_window() -> dict[str, datetime]:
    """starts_at/ends_at for an event that is happening right now (gates open)."""
    now = datetime.now(UTC)
    return {"starts_at": now - timedelta(hours=1), "ends_at": now + timedelta(hours=3)}
