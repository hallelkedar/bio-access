"""Tiny in-memory images for upload tests."""

import io

from PIL import Image


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (8, 8)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format=fmt)
    return buffer.getvalue()
