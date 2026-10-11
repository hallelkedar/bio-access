import time
from collections.abc import Iterator
from contextlib import contextmanager


class Timings:
    """Durations of named steps of one request, for the Server-Timing response header.

    Measurement only: never influences a decision.
    """

    def __init__(self) -> None:
        self.durations_ms: dict[str, float] = {}

    @contextmanager
    def measure(self, name: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            elapsed = (time.perf_counter() - start) * 1000
            self.durations_ms[name] = self.durations_ms.get(name, 0.0) + elapsed

    def header(self) -> str:
        """e.g. 'face;dur=212.4, db;dur=3.1, total;dur=219.8' (shown in browser DevTools)."""
        return ", ".join(f"{name};dur={ms:.1f}" for name, ms in self.durations_ms.items())
