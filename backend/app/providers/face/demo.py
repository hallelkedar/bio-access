"""DEMO ONLY: shows the face-entry flow with a webcam, without AWS. NOT real face recognition.

- check_quality: real but simple pixel checks (darkness, blur, size); it cannot count faces.
- search: returns the most recently enrolled ticket of the event (similarity 99.0).
- State (event -> enrolled face ids and ticket ids) is kept in a small JSON file so it
  survives backend restarts. It never contains images or anything derived from them.
"""

import io
import json
import logging
import secrets
import threading
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat, UnidentifiedImageError

from app.providers.face.base import (
    CollectionNotFoundError,
    FaceMatch,
    FaceProvider,
    QualityIssue,
    QualityResult,
    collection_id_for,
)
from app.utils.image_validation import InvalidImageError

logger = logging.getLogger(__name__)

DEMO_SIMILARITY = 99.0
MIN_SIDE_PX = 120
MIN_BRIGHTNESS = 50.0  # mean gray level, 0-255
MIN_EDGE_DETAIL = 3.0  # spread of edge strength; flat or very blurry images score ~0-2


class DemoFaceProvider(FaceProvider):
    def __init__(self, state_file: Path) -> None:
        self._file = state_file
        self._lock = threading.Lock()
        logger.warning("FACE_PROVIDER=demo: NOT real face recognition. Never use it in production.")

    # --- state file (ids only) -------------------------------------------------------
    def _load(self) -> dict[str, list[dict[str, object]]]:
        try:
            data = json.loads(self._file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save(self, state: dict[str, list[dict[str, object]]]) -> None:
        temporary = self._file.with_suffix(".tmp")
        temporary.write_text(json.dumps(state), encoding="utf-8")
        temporary.replace(self._file)  # atomic: never a half-written file

    def _faces(self, state: dict[str, list[dict[str, object]]], event_id: int) -> list[dict[str, object]]:
        faces = state.get(collection_id_for(event_id))
        if faces is None:
            raise CollectionNotFoundError(collection_id_for(event_id))
        return faces

    # --- FaceProvider ----------------------------------------------------------------
    def ensure_collection(self, event_id: int) -> str:
        with self._lock:
            state = self._load()
            state.setdefault(collection_id_for(event_id), [])
            self._save(state)
        return collection_id_for(event_id)

    def check_quality(self, image: bytes) -> QualityResult:
        try:
            with Image.open(io.BytesIO(image)) as picture:
                gray = picture.convert("L")
        except (UnidentifiedImageError, OSError) as exc:
            raise InvalidImageError("not a readable image") from exc
        issues: list[QualityIssue] = []
        if min(gray.size) < MIN_SIDE_PX:
            issues.append(QualityIssue.TOO_SMALL)
        sample = gray.resize((160, 120))
        if ImageStat.Stat(sample).mean[0] < MIN_BRIGHTNESS:
            issues.append(QualityIssue.TOO_DARK)
        # FIND_EDGES marks the image border itself as an edge: crop it before measuring.
        edges = sample.filter(ImageFilter.FIND_EDGES).crop((2, 2, sample.width - 2, sample.height - 2))
        if ImageStat.Stat(edges).stddev[0] < MIN_EDGE_DETAIL:
            issues.append(QualityIssue.BLURRY)
        return QualityResult(tuple(issues))

    def enroll(self, event_id: int, ticket_id: int, image: bytes) -> str:
        face_id = f"demo-{secrets.token_hex(8)}"
        with self._lock:
            state = self._load()
            self._faces(state, event_id).append({"face_id": face_id, "ticket_id": ticket_id})
            self._save(state)
        return face_id

    def search(self, event_id: int, image: bytes, threshold: float) -> FaceMatch | None:
        with self._lock:
            # Events activated before switching to demo have no entry yet: nobody enrolled.
            faces = self._load().get(collection_id_for(event_id), [])
        if not faces or DEMO_SIMILARITY < threshold:
            return None
        latest = faces[-1]  # demo rule: whoever enrolled last for this event
        return FaceMatch(ticket_id=int(str(latest["ticket_id"])), face_id=str(latest["face_id"]), similarity=DEMO_SIMILARITY)

    def delete_face(self, event_id: int, face_id: str) -> None:
        with self._lock:
            state = self._load()
            key = collection_id_for(event_id)
            if key in state:
                state[key] = [face for face in state[key] if face["face_id"] != face_id]
                self._save(state)

    def delete_collection(self, event_id: int) -> None:
        with self._lock:
            state = self._load()
            if state.pop(collection_id_for(event_id), None) is not None:
                self._save(state)
