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
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine, select

os.environ.setdefault("database_url", "sqlite:///test.db")
os.environ.setdefault("secret_key", "test-secret")

from app.domains.user.api.user_controller import put_profile
from app.model.user.user import User, UserOut, UserProfile

WORK_ROLE_KEYS = (
    "engineering",
    "design",
    "product",
    "marketing",
    "finance",
    "legal",
    "security",
    "operations",
    "other",
)


class _ProfileUser:
    def __init__(self, *, work_role_key: str | None = "design"):
        self.fullname = "Existing Name"
        self.nickname = "Existing Nickname"
        self.work_desc = "Existing description"
        self.work_role_key = work_role_key
        self.saved_with = None

    def save(self, session):
        self.saved_with = session


@pytest.mark.parametrize("work_role_key", WORK_ROLE_KEYS)
def test_profile_accepts_supported_work_roles(work_role_key: str):
    profile = UserProfile(work_role_key=work_role_key)

    assert profile.work_role_key == work_role_key


def test_profile_rejects_unknown_work_role():
    with pytest.raises(ValidationError):
        UserProfile(work_role_key="sales")


def test_role_only_update_preserves_existing_profile_fields():
    user = _ProfileUser()
    session = object()

    result = put_profile(
        UserProfile(work_role_key="engineering"),
        db_session=session,
        auth=SimpleNamespace(user=user),
    )

    assert result is user
    assert user.fullname == "Existing Name"
    assert user.nickname == "Existing Nickname"
    assert user.work_desc == "Existing description"
    assert user.work_role_key == "engineering"
    assert user.saved_with is session


def test_legacy_profile_update_preserves_existing_work_role():
    user = _ProfileUser(work_role_key="product")

    put_profile(
        UserProfile(
            fullname="Updated Name",
            nickname="Updated Nickname",
            work_desc="Updated description",
        ),
        db_session=object(),
        auth=SimpleNamespace(user=user),
    )

    assert user.fullname == "Updated Name"
    assert user.nickname == "Updated Nickname"
    assert user.work_desc == "Updated description"
    assert user.work_role_key == "product"


def test_explicit_null_clears_work_role():
    user = _ProfileUser(work_role_key="security")

    put_profile(
        UserProfile(work_role_key=None),
        db_session=object(),
        auth=SimpleNamespace(user=user),
    )

    assert user.work_role_key is None


def test_omitted_profile_fields_are_distinct_from_explicit_role_clear():
    assert UserProfile().model_fields_set == set()
    assert UserProfile(work_role_key=None).model_fields_set == {"work_role_key"}


def test_legacy_profile_strings_do_not_accept_null():
    with pytest.raises(ValidationError):
        UserProfile(fullname=None)


def test_work_role_persists_across_database_reload():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    User.__table__.create(engine)

    with Session(engine) as session:
        user = User(email="role-persistence@example.com", work_role_key="finance")
        session.add(user)
        session.commit()
        user_id = user.id

    with Session(engine) as session:
        reloaded = session.exec(select(User).where(User.id == user_id)).one()

        assert reloaded.work_role_key == "finance"


def test_user_work_role_api_fixture_matches_models(server_root: Path):
    fixture_path = server_root / "tests/fixtures/user_work_role_api.json"
    fixture = json.loads(fixture_path.read_text())

    role_update = UserProfile.model_validate(fixture["role_update_request"])
    legacy_update = UserProfile.model_validate(fixture["legacy_profile_update_request"])
    clear_update = UserProfile.model_validate(fixture["clear_role_request"])
    response = UserOut.model_validate(fixture["user_response"])

    assert role_update.model_fields_set == {"work_role_key"}
    assert legacy_update.model_fields_set == {"fullname", "nickname", "work_desc"}
    assert clear_update.model_fields_set == {"work_role_key"}
    assert clear_update.work_role_key is None
    assert response.work_role_key == "engineering"
