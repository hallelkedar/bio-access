from pydantic import BaseModel


class WebhookAck(BaseModel):
    received: bool = True
