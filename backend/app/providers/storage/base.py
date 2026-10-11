from abc import ABC, abstractmethod


class StorageService(ABC):
    """Public file storage (event covers). Face images are never stored here."""

    @abstractmethod
    def upload(self, key: str, data: bytes, content_type: str) -> str:
        """Store data under key and return its public URL."""
