"""cover links of local storage become site-relative (/media/...)

Revision ID: 7c2e9a41b5d0
Revises: 131f369deb19
Create Date: 2026-10-12 18:00:00.000000

Covers uploaded with local storage were saved as http://localhost:8000/media/... (or
https://localhost/media/... from Docker). That host is wrong for any other address the app
is opened on (a phone on the LAN, the Docker stack), so keep only the /media/... path.
S3 links point at the bucket and don't match /media/, so they stay as they are.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7c2e9a41b5d0'
down_revision: Union[str, Sequence[str], None] = '131f369deb19'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Strip scheme and host from local-storage cover links."""
    op.execute(
        "UPDATE events SET cover_image_url = regexp_replace(cover_image_url, '^https?://[^/]+(/media/)', '\\1') "
        "WHERE cover_image_url ~ '^https?://[^/]+/media/'"
    )


def downgrade() -> None:
    """Nothing to undo: relative links also work with the old code's /media mount."""
