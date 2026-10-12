"""Give the demo events generated cover art.

Usage (from backend/, API running with the same .env):
    .venv/bin/python -m scripts.demo_covers --base-url http://localhost:8000
    # Docker stack: --base-url https://localhost --insecure
    # --force   replace covers that are already set
    # --render  re-render the JPGs from the SVGs first (needs ImageMagick's `magick`)

Uploads go through the real API (POST /api/events/{id}/cover) as the first admin in the
database, so validation and storage work exactly as in the browser. An event whose name
matches no artwork gets the neutral BioAccess cover. The art lives in scripts/demo_cover_art/.
"""

import argparse
import shutil
import subprocess
from datetime import timedelta
from pathlib import Path

import httpx
from sqlalchemy import select

from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.user import User, UserRole

ART_DIR = Path(__file__).parent / "demo_cover_art"
GENERIC = "generic"
# Lower-case fragment of the event name -> artwork file (without extension).
ARTWORK: dict[str, str] = {
    "tech conference": "tech-conference",
    "jazz": "jazz-night",
    "winter gala": "winter-gala",
    "spring music": "spring-festival",
    "summer concert": "summer-concert",
    "book fair": "book-fair",
}


def cover_for(event_name: str) -> str:
    """The artwork that fits an event name, or the neutral one."""
    name = event_name.casefold()
    return next((art for fragment, art in ARTWORK.items() if fragment in name), GENERIC)


def render(art_dir: Path = ART_DIR) -> None:
    """Re-render every SVG to a 1600x900 JPG next to it."""
    if shutil.which("magick") is None:
        raise SystemExit("--render needs ImageMagick (`magick`); the committed JPGs work without it")
    for svg in sorted(art_dir.glob("*.svg")):
        subprocess.run(
            ["magick", "-density", "96", str(svg), "-resize", "1600x900", "-quality", "84",
             "-sampling-factor", "4:2:0", "-strip", str(svg.with_suffix(".jpg"))],
            check=True,
        )
        print(f"rendered {svg.with_suffix('.jpg').name}")


def admin_token() -> str:
    """A short-lived token for the first admin (create one with app.cli.create_admin)."""
    with SessionLocal() as db:
        admin = db.scalars(select(User).where(User.role == UserRole.ADMIN).order_by(User.id)).first()
        if admin is None:
            raise SystemExit("no admin user: run `python -m app.cli.create_admin` first")
        return create_access_token(admin.id, admin.role, timedelta(minutes=10))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--force", action="store_true", help="replace covers that are already set")
    parser.add_argument("--render", action="store_true", help="re-render the JPGs from the SVGs first")
    parser.add_argument("--insecure", action="store_true", help="accept a self-signed HTTPS certificate")
    args = parser.parse_args()

    if args.render:
        render()
    headers = {"Authorization": f"Bearer {admin_token()}"}
    with httpx.Client(base_url=args.base_url, headers=headers, verify=not args.insecure, timeout=30) as http:
        events = http.get("/api/admin/events")
        events.raise_for_status()
        for event in events.json():
            if event["cover_image_url"] and not args.force:
                print(f"skip     {event['name']} (has a cover; --force replaces it)")
                continue
            art = ART_DIR / f"{cover_for(event['name'])}.jpg"
            response = http.post(f"/api/events/{event['id']}/cover", files={"file": (art.name, art.read_bytes(), "image/jpeg")})
            response.raise_for_status()
            print(f"uploaded {event['name']} <- {art.name}")


if __name__ == "__main__":
    main()
