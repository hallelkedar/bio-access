import io

from PIL import Image

from app.utils.qr import make_qr_png


def test_returns_square_png() -> None:
    png = make_qr_png("some-token")

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    image = Image.open(io.BytesIO(png))
    assert image.format == "PNG"
    assert image.width == image.height >= 200


def test_different_data_gives_different_image() -> None:
    assert make_qr_png("token-a") != make_qr_png("token-b")
