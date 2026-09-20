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
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.domains.space.service.space_service import SpaceService
from app.model.space import SpaceIn, SpaceOut, SpaceUpdate


class _FakeSession:
    def __init__(self, space=None):
        self.space = space
        self.added = []
        self.commit_count = 0

    def get(self, _model, _id):
        return self.space

    def add(self, value):
        self.added.append(value)
        self.space = value

    def commit(self):
        self.commit_count += 1

    def refresh(self, _value):
        return None


def _space(*, category_key: str | None = None):
    return SimpleNamespace(
        id="space_1",
        user_id="user_1",
        name="Research",
        description=None,
        source_type="blank",
        root_path=None,
        root_fingerprint=None,
        status="active",
        category_key=category_key,
        schema_version=1,
        metadata_json=None,
        created_at=datetime(2026, 9, 20),
        updated_at=datetime(2026, 9, 20),
    )


def test_space_input_accepts_content_defined_category_key():
    payload = SpaceIn(
        name="Customer research",
        category_key="customer-success",
    )

    assert payload.category_key == "customer-success"


@pytest.mark.parametrize(
    "category_key",
    [
        "Customer-Success",
        "customer success",
        "customer_success",
        "1-customer-success",
        "customer-success-",
        "a" * 51,
    ],
)
def test_space_input_rejects_malformed_content_category_key(category_key: str):
    with pytest.raises(ValidationError):
        SpaceIn(name="Unknown", category_key=category_key)


def test_create_space_persists_category():
    session = _FakeSession()

    space = SpaceService.create_space(
        SpaceIn(name="Customer success", category_key="customer-success"),
        "user_1",
        session,
    )

    assert space.category_key == "customer-success"
    assert session.added == [space]
    assert session.commit_count == 1


def test_update_space_preserves_omitted_category():
    space = _space(category_key="finance")
    session = _FakeSession(space)

    updated = SpaceService.update_space(
        space.id,
        SpaceUpdate(name="Quarterly review"),
        space.user_id,
        session,
    )

    assert updated.category_key == "finance"


def test_update_space_explicit_null_clears_category():
    space = _space(category_key="legal")
    session = _FakeSession(space)

    updated = SpaceService.update_space(
        space.id,
        SpaceUpdate(category_key=None),
        space.user_id,
        session,
    )

    assert updated.category_key is None


def test_space_output_includes_category():
    output = SpaceOut.from_model(_space(category_key="design"))

    assert output.category_key == "design"


def test_space_category_api_fixture_matches_models(server_root: Path):
    fixture_path = server_root / "tests/fixtures/space_category_api.json"
    fixture = json.loads(fixture_path.read_text())

    assert SpaceIn.model_validate(fixture["create_request"]).category_key == "customer-success"
    assert SpaceUpdate.model_validate(fixture["update_request"]).category_key == "revenue-operations"
    assert SpaceUpdate.model_validate(fixture["clear_request"]).model_fields_set == {"category_key"}
    assert SpaceOut.model_validate(fixture["space_response"]).category_key == "customer-success"
