import pytest

from scripts.measure_latency import parse_server_timing, percentile, summarize


def test_percentile_nearest_rank() -> None:
    values = list(range(1, 101))  # 1..100

    assert percentile(values, 50) == 50
    assert percentile(values, 95) == 95
    assert percentile(values, 99) == 99
    assert percentile(values, 100) == 100
    assert percentile([7.0], 95) == 7.0


def test_summarize() -> None:
    stats = summarize([10.0, 20.0, 30.0, 40.0])

    assert stats["n"] == 4
    assert stats["mean"] == pytest.approx(25.0)
    assert stats["max"] == 40.0
    assert summarize([]) == {}


def test_parse_server_timing() -> None:
    assert parse_server_timing("face;dur=212.4, db;dur=3.1, total;dur=219.8") == {
        "face": 212.4,
        "db": 3.1,
        "total": 219.8,
    }
    assert parse_server_timing("") == {}
