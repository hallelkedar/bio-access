"""Tiny in-memory images for upload tests."""

import io
import os

from PIL import Image


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (8, 8)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format=fmt)
    return buffer.getvalue()


def noise_png(size: tuple[int, int]) -> bytes:
    """Random pixels barely compress, so the PNG is about width*height*3 bytes."""
    buffer = io.BytesIO()
    Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)).save(buffer, format="PNG")
    return buffer.getvalue()
