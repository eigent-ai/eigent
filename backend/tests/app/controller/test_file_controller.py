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

import logging

from app.controller import file_controller


def test_resolve_project_root_prefers_user_id_root(monkeypatch, tmp_path, caplog):
    eigent_root = tmp_path / "eigent"
    user_project = eigent_root / "user_20" / "project_p1"
    user_project.mkdir(parents=True)
    (eigent_root / "other_user" / "project_p1").mkdir(parents=True)

    monkeypatch.setattr(file_controller, "_get_eigent_root", lambda: eigent_root)
    file_controller._PROJECT_ROOT_FALLBACK_CACHE.clear()
    caplog.set_level(logging.INFO, logger="file_controller")

    resolved = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1", "20"
    )

    assert resolved == user_project
    assert "Resolved project root via fallback lookup" not in caplog.text


def test_resolve_project_root_caches_fallback_lookup(
    monkeypatch, tmp_path, caplog
):
    eigent_root = tmp_path / "eigent"
    fallback_project = eigent_root / "user_20" / "project_p1"
    fallback_project.mkdir(parents=True)

    monkeypatch.setattr(file_controller, "_get_eigent_root", lambda: eigent_root)
    file_controller._PROJECT_ROOT_FALLBACK_CACHE.clear()
    caplog.set_level(logging.INFO, logger="file_controller")

    first = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1"
    )
    second = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1"
    )

    assert first == fallback_project
    assert second == fallback_project
    assert caplog.text.count("Resolved project root via fallback lookup") == 1
