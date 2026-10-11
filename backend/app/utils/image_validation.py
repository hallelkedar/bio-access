import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

# Detected from the bytes themselves; the client's filename/Content-Type is never trusted.
ALLOWED_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}
MAX_PIXELS = 25_000_000  # guards against decompression bombs (tiny file, huge image)


class InvalidImageError(Exception):
    pass


class ImageTooLargeError(Exception):
    pass


@dataclass(frozen=True)
class ValidatedImage:
    content_type: str
    extension: str
    width: int
    height: int


def validate_image(data: bytes, max_bytes: int) -> ValidatedImage:
    """Check size, then fully decode the image in memory; only JPEG/PNG/WebP pass."""
    if len(data) > max_bytes:
        raise ImageTooLargeError(f"file is larger than {max_bytes} bytes")
    if not data:
        raise InvalidImageError("file is empty")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise InvalidImageError("only JPEG, PNG or WebP images are allowed")
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise InvalidImageError("image dimensions are too large")
            image.load()  # decodes every pixel: catches truncated or corrupt files
            content_type, extension = ALLOWED_FORMATS[image.format]
    except InvalidImageError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise InvalidImageError("file is not a valid image") from None
    return ValidatedImage(content_type, extension, width, height)
