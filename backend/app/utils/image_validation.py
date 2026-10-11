import io
from collections.abc import Collection
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

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
    format: str  # Pillow name: JPEG, PNG or WEBP
    content_type: str
    extension: str
    width: int
    height: int


def validate_image(
    data: bytes, max_bytes: int, allowed_formats: Collection[str] = tuple(ALLOWED_FORMATS)
) -> ValidatedImage:
    """Check size, then fully decode the image in memory; only allowed_formats pass."""
    if len(data) > max_bytes:
        raise ImageTooLargeError(f"file is larger than {max_bytes} bytes")
    if not data:
        raise InvalidImageError("file is empty")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ALLOWED_FORMATS or image.format not in allowed_formats:
                names = ", ".join(sorted(f for f in ALLOWED_FORMATS if f in allowed_formats))
                raise InvalidImageError(f"only {names} images are allowed")
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise InvalidImageError("image dimensions are too large")
            image.load()  # decodes every pixel: catches truncated or corrupt files
            image_format = image.format
            content_type, extension = ALLOWED_FORMATS[image_format]
    except InvalidImageError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise InvalidImageError("file is not a valid image") from None
    return ValidatedImage(image_format, content_type, extension, width, height)


def sanitize_image(data: bytes, image: ValidatedImage) -> bytes:
    """Re-encode the decoded pixels into a fresh file of the same format.

    Drops all metadata (EXIF incl. GPS location, comments, text chunks) and any
    bytes hidden after the image (polyglot files). The EXIF rotation is applied
    first, so the picture still shows the right way up.
    """
    with Image.open(io.BytesIO(data)) as original:
        pixels = ImageOps.exif_transpose(original)
        output = io.BytesIO()
        options = {"quality": 90} if image.format in ("JPEG", "WEBP") else {}
        pixels.save(output, format=image.format, **options)
    return output.getvalue()
