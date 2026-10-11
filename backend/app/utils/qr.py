import io

import qrcode
from qrcode.constants import ERROR_CORRECT_M


def make_qr_png(data: str, box_size: int = 10, border: int = 4) -> bytes:
    """Render data as a QR code PNG, entirely in memory (nothing is written to disk)."""
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=box_size, border=border)
    qr.add_data(data)
    qr.make(fit=True)
    buffer = io.BytesIO()
    qr.make_image().save(buffer, format="PNG")
    return buffer.getvalue()
