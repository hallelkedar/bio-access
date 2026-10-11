"""Spec §12 case 6: malicious file uploads are rejected or neutralized."""

import io
from collections.abc import Callable

import pytest
from PIL import Image

from app.utils.image_validation import InvalidImageError, sanitize_image, validate_image
from tests import malicious

MB = 1024 * 1024


@pytest.mark.parametrize(
    "make_payload",
    [malicious.svg_with_script, malicious.html_page, malicious.zip_archive, malicious.decompression_bomb_png],
    ids=["svg-script", "html-renamed", "zip-renamed", "decompression-bomb"],
)
def test_hostile_files_rejected(make_payload: Callable[[], bytes]) -> None:
    with pytest.raises(InvalidImageError):
        validate_image(make_payload(), MB)


def test_decompression_bomb_is_tiny_but_rejected_from_header() -> None:
    bomb = malicious.decompression_bomb_png()

    assert len(bomb) < 200  # never decoded: rejected on its declared size alone
    with pytest.raises(InvalidImageError):
        validate_image(bomb, MB)


def test_polyglot_passes_validation_but_sanitizing_removes_payload() -> None:
    data = malicious.polyglot_jpeg()
    image = validate_image(data, MB)  # a real JPEG, so it is accepted...

    clean = sanitize_image(data, image)

    assert b"<script>" in data
    assert b"<script>" not in clean  # ...but the hidden payload is never stored
    assert Image.open(io.BytesIO(clean)).format == "JPEG"


def test_sanitizing_strips_exif_metadata() -> None:
    data = malicious.jpeg_with_metadata()
    assert Image.open(io.BytesIO(data)).getexif()  # metadata present before

    clean = sanitize_image(data, validate_image(data, MB))

    assert b"secret-location" not in clean
    assert not Image.open(io.BytesIO(clean)).getexif()


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_sanitizing_keeps_format_and_size(fmt: str) -> None:
    from tests.images import image_bytes

    data = image_bytes(fmt, (20, 12))

    clean = Image.open(io.BytesIO(sanitize_image(data, validate_image(data, MB))))

    assert (clean.format, clean.size) == (fmt, (20, 12))


def test_exif_rotation_applied_before_stripping() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° to display
    buffer = io.BytesIO()
    Image.new("RGB", (30, 10)).save(buffer, format="JPEG", exif=exif.tobytes())
    data = buffer.getvalue()

    clean = Image.open(io.BytesIO(sanitize_image(data, validate_image(data, MB))))

    assert clean.size == (10, 30)  # stored upright, so no orientation tag is needed
