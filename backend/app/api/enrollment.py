from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.uploads import IMAGE_BODY_OPENAPI, read_body_in_memory, too_large
from app.core.config import get_settings
from app.core.deps import require_role
from app.db.session import get_db
from app.models.user import User, UserRole
from app.providers.face import get_face_provider
from app.providers.face.base import FaceProvider, FaceProviderError
from app.schemas.enrollment import EnrollmentRead
from app.services import enrollment as enrollment_service
from app.utils.image_validation import ImageTooLargeError, InvalidImageError

router = APIRouter(prefix="/api/enrollment", tags=["enrollment"])

require_user = require_role(UserRole.USER)


@router.post(
    "",
    response_model=EnrollmentRead,
    status_code=status.HTTP_201_CREATED,
    openapi_extra=IMAGE_BODY_OPENAPI,
)
async def enroll(
    request: Request,
    ticket_id: int = Query(),
    consent: bool = Query(description="The user agreed to biometric processing"),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    face_provider: FaceProvider = Depends(get_face_provider),
) -> EnrollmentRead:
    """Body: the raw JPEG/PNG photo (not multipart)."""
    return await _with_photo(enrollment_service.enroll_face, request, ticket_id, consent, db, user, face_provider)


@router.put("", response_model=EnrollmentRead, openapi_extra=IMAGE_BODY_OPENAPI)
async def replace(
    request: Request,
    ticket_id: int = Query(),
    consent: bool = Query(description="The user agreed to biometric processing"),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    face_provider: FaceProvider = Depends(get_face_provider),
) -> EnrollmentRead:
    """Change the face photo of an enrolled ticket. Body: the raw JPEG/PNG photo (not multipart)."""
    return await _with_photo(enrollment_service.replace_face, request, ticket_id, consent, db, user, face_provider)


async def _with_photo(
    service: Callable[..., EnrollmentRead],
    request: Request,
    ticket_id: int,
    consent: bool,
    db: Session,
    user: User,
    face_provider: FaceProvider,
) -> EnrollmentRead:
    """Read the photo into memory, run the enrollment service, and map its errors to HTTP."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    image = await read_body_in_memory(request, max_bytes)
    try:
        return await run_in_threadpool(service, db, face_provider, user, ticket_id, image, consent, max_bytes)
    except enrollment_service.ConsentRequiredError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="consent is required")
    except enrollment_service.TicketNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ticket not found")
    except enrollment_service.TicketNotValidError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ticket is not valid")
    except enrollment_service.EventNotOpenError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="event is not open for enrollment")
    except enrollment_service.AlreadyEnrolledError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ticket is already enrolled")
    except enrollment_service.NotEnrolledError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ticket is not enrolled yet")
    except enrollment_service.LowQualityError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "photo quality is too low", "issues": [i.value for i in exc.issues]},
        )
    except ImageTooLargeError:
        raise too_large()
    except InvalidImageError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc))
    except FaceProviderError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="face service unavailable, try again")
    finally:
        del image  # drop our reference as soon as the request is done
