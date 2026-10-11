import pytest

from app.utils.image_validation import ImageTooLargeError, InvalidImageError, validate_image
from tests.images import image_bytes

MB = 1024 * 1024


@pytest.mark.parametrize(
    ("fmt", "content_type", "extension"),
    [("PNG", "image/png", "png"), ("JPEG", "image/jpeg", "jpg"), ("WEBP", "image/webp", "webp")],
)
def test_allowed_formats(fmt: str, content_type: str, extension: str) -> None:
    image = validate_image(image_bytes(fmt, (10, 6)), MB)

    assert image.content_type == content_type
    assert image.extension == extension
    assert (image.width, image.height) == (10, 6)


def test_too_large_rejected() -> None:
    with pytest.raises(ImageTooLargeError):
        validate_image(image_bytes(), max_bytes=10)


@pytest.mark.parametrize("data", [b"", b"<?php echo 'hi'; ?>", b"\x89PNG\r\n\x1a\nnot really"])
def test_non_images_rejected(data: bytes) -> None:
    with pytest.raises(InvalidImageError):
        validate_image(data, MB)


def test_truncated_image_rejected() -> None:
    data = image_bytes("JPEG", (64, 64))

    with pytest.raises(InvalidImageError):
        validate_image(data[: len(data) // 2], MB)


def test_gif_rejected() -> None:
    with pytest.raises(InvalidImageError, match="only JPEG, PNG, WEBP images"):
        validate_image(image_bytes("GIF"), MB)


def test_huge_dimensions_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.utils.image_validation.MAX_PIXELS", 50)

    with pytest.raises(InvalidImageError, match="dimensions"):
        validate_image(image_bytes("PNG", (10, 10)), MB)


def test_allowed_formats_can_be_narrowed() -> None:
    with pytest.raises(InvalidImageError, match="only JPEG, PNG images"):
        validate_image(image_bytes("WEBP"), MB, allowed_formats=("JPEG", "PNG"))
