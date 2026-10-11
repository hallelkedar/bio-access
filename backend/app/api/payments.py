from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db.session import get_db
from app.providers.payment import get_payment_provider
from app.providers.payment.base import InvalidWebhookError, PaymentProvider
from app.schemas.payment import WebhookAck
from app.services import payment as payment_service

router = APIRouter(tags=["payments"])


@router.post("/webhooks/payment", response_model=WebhookAck)
async def payment_webhook(
    request: Request,
    db: Session = Depends(get_db),
    provider: PaymentProvider = Depends(get_payment_provider),
) -> WebhookAck:
    """Called by the payment provider, not by users: the signature is the authentication."""
    payload = await request.body()  # raw bytes: the signature covers the exact body
    try:
        # The service uses a sync DB session: run it off the event loop.
        await run_in_threadpool(payment_service.handle_webhook, db, provider, payload, request.headers)
    except InvalidWebhookError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid webhook")
    return WebhookAck()
