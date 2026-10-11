from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.uploads import IMAGE_BODY_OPENAPI, read_body_in_memory, too_large
from app.core.config import get_settings
from app.core.deps import require_role
from app.db.session import get_db
from app.models.access_log import AccessMethod
from app.models.user import User, UserRole
from app.providers.face import get_face_provider
from app.providers.face.base import FaceProvider
from app.schemas.gate import GateQrVerify, GateVerifyResult
from app.services import access_control, realtime
from app.services.event import EventNotFoundError
from app.utils.image_validation import ImageTooLargeError

router = APIRouter(prefix="/api/gate", tags=["gate"])

require_gatekeeper = require_role(UserRole.GATEKEEPER)


@router.post("/verify", response_model=GateVerifyResult, openapi_extra=IMAGE_BODY_OPENAPI)
async def verify(
    request: Request,
    background_tasks: BackgroundTasks,
    event_id: int = Query(),
    gate_id: str = Query(min_length=1, max_length=64, description="Which gate, e.g. north-1"),
    db: Session = Depends(get_db),
    _: User = Depends(require_gatekeeper),
    face_provider: FaceProvider = Depends(get_face_provider),
) -> GateVerifyResult:
    """Body: one raw JPEG/PNG camera frame. Approval marks the ticket ENTERED.

    A denial is a normal 200 answer with a reason. Every attempt is logged.
    """
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    image = await read_body_in_memory(request, max_bytes)
    try:
        decision = await run_in_threadpool(
            access_control.verify_face, db, face_provider, event_id, gate_id, image, max_bytes
        )
    except EventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    except ImageTooLargeError:
        raise too_large()
    finally:
        del image
    _publish(background_tasks, event_id, gate_id, AccessMethod.FACE, decision)
    return decision


@router.post("/verify-qr", response_model=GateVerifyResult)
def verify_qr(
    data: GateQrVerify,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_gatekeeper),
) -> GateVerifyResult:
    """Fallback when face recognition fails. Compare user_name with the guest's ID."""
    try:
        decision = access_control.verify_qr(db, data.event_id, data.gate_id, data.qr_token)
    except EventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    _publish(background_tasks, data.event_id, data.gate_id, AccessMethod.QR, decision)
    return decision


def _publish(
    background_tasks: BackgroundTasks,
    event_id: int,
    gate_id: str,
    method: AccessMethod,
    decision: GateVerifyResult,
) -> None:
    """Push the decision to admin dashboards after the response is sent (no added gate latency)."""
    message = realtime.access_event_message(event_id, gate_id, method, decision, datetime.now(UTC))
    background_tasks.add_task(realtime.publish_access_event, message)
