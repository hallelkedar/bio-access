from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.uploads import IMAGE_BODY_OPENAPI, read_body_in_memory, too_large
from app.core.config import get_settings
from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.providers.face import get_face_provider
from app.providers.face.base import FaceProvider
from app.schemas.gate import GateVerifyResult
from app.services import access_control
from app.services.event import EventNotFoundError
from app.utils.image_validation import ImageTooLargeError

router = APIRouter(prefix="/api/gate", tags=["gate"])

require_gatekeeper = require_role(UserRole.GATEKEEPER)


@router.post("/verify", response_model=GateVerifyResult, openapi_extra=IMAGE_BODY_OPENAPI)
async def verify(
    request: Request,
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
        return await run_in_threadpool(
            access_control.verify_face, db, face_provider, event_id, gate_id, image, max_bytes
        )
    except EventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    except ImageTooLargeError:
        raise too_large()
    finally:
        del image
