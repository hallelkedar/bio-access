import pytest
from PIL import Image

from app.utils.image_validation import validate_image
from scripts.demo_covers import ART_DIR, ARTWORK, GENERIC, cover_for


@pytest.mark.parametrize(
    ("name", "art"),
    [
        ("Tech Conference 2026", "tech-conference"),
        ("Jazz Night at the Port", "jazz-night"),
        ("WINTER GALA", "winter-gala"),
        ("Spring Music Festival in the Park with a Very Long Name", "spring-festival"),
        ("Summer Concert", "summer-concert"),
        ("Book Fair", "book-fair"),
        ("sdfgdsfg", GENERIC),
        ("", GENERIC),
    ],
)
def test_cover_for_matches_name_fragments(name: str, art: str) -> None:
    assert cover_for(name) == art


@pytest.mark.parametrize("art", [*ARTWORK.values(), GENERIC])
def test_every_artwork_is_a_committed_jpeg_the_api_accepts(art: str) -> None:
    jpg = ART_DIR / f"{art}.jpg"
    assert (ART_DIR / f"{art}.svg").is_file()

    with Image.open(jpg) as image:
        assert image.format == "JPEG"
        assert image.size == (1600, 900)
    validate_image(jpg.read_bytes(), max_bytes=2 * 1024 * 1024)  # raises if the upload would be rejected
