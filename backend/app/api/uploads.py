from fastapi import HTTPException, Request, status

# Documents a raw-image request body in /docs (the body is not multipart).
IMAGE_BODY_OPENAPI = {
    "requestBody": {
        "required": True,
        "content": {
            "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
            "image/png": {"schema": {"type": "string", "format": "binary"}},
        },
    }
}


RAW_IMAGE_TYPES = ("image/jpeg", "image/png")


def too_large() -> HTTPException:
    return HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="image is too large")


async def read_body_in_memory(request: Request, max_bytes: int) -> bytes:
    """Read the raw image body into memory, stopping once it exceeds max_bytes.

    Deliberately not UploadFile/multipart: those spool large uploads to a temp
    file on disk, and face images must never touch the disk.
    A Content-Type other than JPEG/PNG is refused (415) before reading; the
    bytes themselves are still checked later.
    """
    media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if media_type not in RAW_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="body must be image/jpeg or image/png"
        )
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise too_large()
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise too_large()
    return bytes(body)
