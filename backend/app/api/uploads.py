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


def too_large() -> HTTPException:
    return HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="image is too large")


async def read_body_in_memory(request: Request, max_bytes: int) -> bytes:
    """Read the raw body into memory, stopping once it exceeds max_bytes.

    Deliberately not UploadFile/multipart: those spool large uploads to a temp
    file on disk, and face images must never touch the disk.
    """
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise too_large()
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise too_large()
    return bytes(body)
