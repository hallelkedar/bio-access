from datetime import datetime

from pydantic import BaseModel


class EnrollmentRead(BaseModel):
    """The face_id stays internal: clients only learn that enrollment succeeded."""

    ticket_id: int
    enrolled_at: datetime
