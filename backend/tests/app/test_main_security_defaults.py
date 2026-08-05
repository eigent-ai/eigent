from pathlib import Path


def test_brain_defaults_to_loopback() -> None:
    source = (Path(__file__).parents[2] / "main.py").read_text()

    assert 'DEFAULT_BRAIN_HOST = "127.0.0.1"' in source
    assert 'env("EIGENT_BRAIN_HOST", DEFAULT_BRAIN_HOST)' in source
