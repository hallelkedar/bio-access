from pathlib import Path

from app.providers.storage.base import StorageService


class LocalStorage(StorageService):
    """Dev storage: files go to a local folder that the app serves at /media."""

    def __init__(self, root: Path, public_base_url: str) -> None:
        self._root = root.resolve()
        self._base_url = public_base_url.rstrip("/")

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        path = (self._root / key).resolve()
        if not path.is_relative_to(self._root):
            raise ValueError("storage key escapes the media folder")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"{self._base_url}/media/{key}"
