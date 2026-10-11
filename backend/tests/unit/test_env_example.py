"""Keep .env.example in step with the settings the code actually reads."""

import re
from pathlib import Path

from app.core.config import Settings

ENV_EXAMPLE = Path(__file__).resolve().parents[3] / ".env.example"


def _documented_keys() -> set[str]:
    keys = set()
    for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^#?\s*([A-Z][A-Z0-9_]+)=", line)  # active or commented-out examples
        if match:
            keys.add(match.group(1))
    return keys


def test_every_setting_is_documented() -> None:
    settings = {name.upper() for name in Settings.model_fields}

    missing = settings - _documented_keys()

    assert missing == set(), f"add to .env.example: {sorted(missing)}"


def test_no_real_secrets_in_example() -> None:
    content = ENV_EXAMPLE.read_text(encoding="utf-8")

    for pattern in (r"sk_(test|live)_[A-Za-z0-9]{10,}", r"whsec_[A-Za-z0-9]{10,}", r"AKIA[0-9A-Z]{16}", r"re_[A-Za-z0-9]{20,}"):
        assert not re.search(pattern, content)
    assert re.search(r"^JWT_SECRET=\s*$", content, re.M)  # must stay empty
