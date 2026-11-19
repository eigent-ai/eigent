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

import asyncio
import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.sql import operators

from app.domains.model_provider.api import provider_controller
from app.model.provider.provider import ProviderModelMetadata, VaildStatus
from app.shared.auth import auth_must


@pytest.mark.parametrize(
    "name,configured_platform,configured_model,category,platform,model",
    [
        ("azure", None, None, "custom", "azure", "deployment"),
        ("ollama", "ollama", "org/model:8b", "local", "ollama", "org/model:8b"),
        ("vllm", "openai", "local-chat", "local", "openai", "local-chat"),
        ("lmstudio", "", "", "local", "lmstudio", "deployment"),
    ],
)
def test_model_catalog_projects_only_portable_metadata(
    name, configured_platform, configured_model, category, platform, model
):
    metadata = ProviderModelMetadata.from_projection(
        name, "deployment", VaildStatus.is_valid, configured_platform, configured_model
    )
    assert metadata.model_dump() == {
        "category": category,
        "model_platform": platform,
        "model_type": model,
        "available": True,
    }
    assert (
        ProviderModelMetadata.from_projection(
            name, "deployment", VaildStatus.not_valid, configured_platform, configured_model
        ).available
        is False
    )


def test_catalog_endpoint_filters_current_user_and_requires_authentication():
    assert inspect.signature(provider_controller.model_catalog).parameters["auth"].default.dependency is auth_must
    db = MagicMock()
    db.exec.return_value.all.return_value = [
        ("ollama", "local", VaildStatus.is_valid, None, None),
        ("vllm", "base-model", VaildStatus.is_valid, "openai", "local-chat"),
    ]
    result = asyncio.run(provider_controller.model_catalog(db_session=db, auth=SimpleNamespace(id=17)))
    query = db.exec.call_args.args[0]
    sql = str(query.compile())
    assert "provider.user_id =" in sql
    assert "deleted" in sql
    assert 17 in query.compile().params.values()
    assert 513 in query.compile().params.values()
    assert len(result) == 2
    assert set(result[0].model_dump()) == {"category", "model_platform", "model_type", "available"}
    assert result[1].model_dump() == {
        "category": "local",
        "model_platform": "openai",
        "model_type": "local-chat",
        "available": True,
    }


@pytest.mark.parametrize("dialect", [postgresql.dialect(), sqlite.dialect()], ids=["postgresql", "sqlite"])
def test_catalog_sql_reads_only_metadata_columns_and_two_config_subfields(dialect):
    db = MagicMock()
    db.exec.return_value.all.return_value = []
    assert asyncio.run(provider_controller.model_catalog(db_session=db, auth=SimpleNamespace(id=17))) == []
    query = db.exec.call_args.args[0]
    columns = list(query.selected_columns)

    # Check the SQL expression tree as well as compiled SQL: a response-only
    # projection would still read credential columns and must fail this test.
    assert len(columns) == 5
    assert [column.name for column in columns[:3]] == ["provider_name", "model_type", "is_vaild"]
    assert [column.name for column in columns[3:]] == ["configured_model_platform", "configured_model_type"]
    for column, json_field in zip(columns[3:], ("model_platform", "model_type"), strict=True):
        expression = column.element
        assert expression.operator is operators.json_getitem_op
        assert expression.left.name == "encrypted_config"
        assert expression.right.value == json_field

    sql = str(query.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    assert "api_key" not in sql
    assert "endpoint_url" not in sql
    assert "provider.user_id = 17" in sql
    assert "provider.deleted_at IS NULL" in sql
    assert "LIMIT 513" in sql
    if dialect.name == "postgresql":
        assert "provider.encrypted_config ->> 'model_platform'" in sql
        assert "provider.encrypted_config ->> 'model_type'" in sql
    else:
        assert "JSON_EXTRACT(provider.encrypted_config" in sql
        assert '$."model_platform"' in sql
        assert '$."model_type"' in sql


def test_catalog_includes_at_most_512_projected_models():
    db = MagicMock()
    db.exec.return_value.all.return_value = [("azure", "deployment", VaildStatus.is_valid, None, None)] * 512
    result = asyncio.run(provider_controller.model_catalog(db_session=db, auth=SimpleNamespace(id=17)))
    assert len(result) == 512


def test_catalog_is_bounded_without_returning_partial_ambiguous_matches():
    db = MagicMock()
    db.exec.return_value.all.return_value = [object()] * 513
    with pytest.raises(HTTPException) as error:
        asyncio.run(provider_controller.model_catalog(db_session=db, auth=SimpleNamespace(id=17)))
    assert error.value.status_code == 413
