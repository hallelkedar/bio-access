from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db.session import get_db, get_session_factory
from app.providers.notify import get_notifier
from app.providers.notify.base import Notifier
from app.providers.payment import get_payment_provider
from app.providers.payment.base import InvalidWebhookError, PaymentProvider
from app.schemas.payment import WebhookAck
from app.services import notification as notification_service
from app.services import payment as payment_service

router = APIRouter(tags=["payments"])


@router.post("/webhooks/payment", response_model=WebhookAck)
async def payment_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    provider: PaymentProvider = Depends(get_payment_provider),
    notifier: Notifier = Depends(get_notifier),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
) -> WebhookAck:
    """Called by the payment provider, not by users: the signature is the authentication."""
    payload = await request.body()  # raw bytes: the signature covers the exact body
    try:
        # The service uses a sync DB session: run it off the event loop.
        activated_ticket_id = await run_in_threadpool(
            payment_service.handle_webhook, db, provider, payload, request.headers
        )
    except InvalidWebhookError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid webhook")
    if activated_ticket_id is not None:
        # Runs after the response: the provider gets its 200 without waiting for email/SMS.
        background_tasks.add_task(
            notification_service.notify_ticket_paid, session_factory, notifier, activated_ticket_id
        )
    return WebhookAck()
