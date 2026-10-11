import re
import time

from app.core.timing import Timings


def test_measures_named_steps_and_formats_header() -> None:
    timings = Timings()

    with timings.measure("face"):
        time.sleep(0.01)
    with timings.measure("db"):
        pass

    assert timings.durations_ms["face"] >= 10
    assert re.fullmatch(r"face;dur=\d+\.\d, db;dur=\d+\.\d", timings.header())


def test_repeated_steps_add_up() -> None:
    timings = Timings()

    for _ in range(2):
        with timings.measure("db"):
            time.sleep(0.005)

    assert timings.durations_ms["db"] >= 10


def test_records_even_when_the_step_fails() -> None:
    timings = Timings()

    try:
        with timings.measure("face"):
            raise RuntimeError("provider down")
    except RuntimeError:
        pass

    assert "face" in timings.durations_ms
