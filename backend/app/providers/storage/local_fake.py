from pathlib import Path

from app.providers.storage.base import StorageService


class LocalStorage(StorageService):
    """Dev storage: files go to a local folder that the app serves at /media.

    URLs are site-relative (/media/...): the browser loads them from whatever address it
    opened the app on (Vite proxy, nginx, a phone on the LAN), so no host is baked into the DB.
    """

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        path = (self._root / key).resolve()
        if not path.is_relative_to(self._root):
            raise ValueError("storage key escapes the media folder")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"/media/{key}"
