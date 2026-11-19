# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import json
from pathlib import Path

import pytest

from app.utils.app_version import (
    APP_VERSION_ENV_KEY,
    UNKNOWN_APP_VERSION,
    resolve_app_version,
)

REPO_PACKAGE_JSON = Path(__file__).resolve().parents[4] / "package.json"


def _package_json(tmp_path: Path, version: object) -> Path:
    path = tmp_path / "package.json"
    path.write_text(json.dumps({"name": "eigent", "version": version}))
    return path


def test_host_env_version_wins(tmp_path):
    package_json = _package_json(tmp_path, "9.9.9")

    assert (
        resolve_app_version({APP_VERSION_ENV_KEY: "1.2.3"}, package_json)
        == "1.2.3"
    )


def test_falls_back_to_package_json_without_host_env(tmp_path):
    package_json = _package_json(tmp_path, "4.5.6-beta.1")

    assert resolve_app_version({}, package_json) == "4.5.6-beta.1"


@pytest.mark.parametrize(
    "value",
    ["../../etc", "1.0/../x", "1.0\\x", " ", "..", "a" * 65],
)
def test_rejects_env_values_unsafe_for_paths(tmp_path, value):
    package_json = _package_json(tmp_path, "4.5.6")

    assert (
        resolve_app_version({APP_VERSION_ENV_KEY: value}, package_json)
        == "4.5.6"
    )


def test_unknown_when_no_source_is_usable(tmp_path):
    assert (
        resolve_app_version({}, tmp_path / "missing.json")
        == UNKNOWN_APP_VERSION
    )
    assert (
        resolve_app_version({}, _package_json(tmp_path, 123))
        == UNKNOWN_APP_VERSION
    )


def test_source_checkout_matches_root_package_json():
    expected = json.loads(REPO_PACKAGE_JSON.read_text(encoding="utf-8"))[
        "version"
    ]

    assert resolve_app_version({}) == expected


def test_terminal_base_venv_path_uses_package_version(monkeypatch):
    import app.agent.toolkit.terminal_toolkit as terminal_toolkit

    monkeypatch.setattr(terminal_toolkit, "APP_VERSION", "7.8.9")

    assert terminal_toolkit.get_terminal_base_venv_path().endswith(
        "terminal_base-7.8.9"
    )
