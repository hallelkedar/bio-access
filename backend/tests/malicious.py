"""Hostile upload samples for validation tests (all built in memory)."""

import io
import struct
import zipfile
import zlib

from PIL import Image

from tests.images import image_bytes


def polyglot_jpeg() -> bytes:
    """A valid JPEG with an HTML/JS payload hidden after the image data."""
    return image_bytes("JPEG", (16, 16)) + b"<html><script>alert('xss')</script></html>"


def jpeg_with_metadata(secret: str = "secret-location-32.08N-34.78E") -> bytes:
    """A JPEG carrying EXIF metadata (description + camera) that must not be published."""
    exif = Image.Exif()
    exif[0x010E] = secret  # ImageDescription
    exif[0x010F] = "SpyCam"  # Make
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (10, 120, 200)).save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def svg_with_script() -> bytes:
    return b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def html_page() -> bytes:
    return b"<!doctype html><html><body onload=alert(1)></body></html>"


def zip_archive() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("payload.exe", b"MZ" + b"\x00" * 64)
    return buffer.getvalue()


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def decompression_bomb_png(width: int = 50_000, height: int = 50_000) -> bytes:
    """A tiny file whose header claims 2.5 billion pixels (would need ~2.5 GB to decode)."""
    header = struct.pack(">IIBBBBB", width, height, 1, 0, 0, 0, 0)  # 1-bit grayscale
    pixels = zlib.compress(b"")  # the attack works on the header alone
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", pixels) + _png_chunk(b"IEND", b"")
