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

"""No route may be able to return a user's own model provider key.

This test builds the same route table as ``main.py`` and walks the response
model of every route, through nested models, lists, unions and pages.

It fails when

* a response model has a field whose name looks like a key or another secret,
  unless that field is listed in ``ALLOWED`` with the reason it is there;
* an entry in ``ALLOWED`` no longer matches anything (so the list stays true);
* a route that deals with model providers, with the execution configuration or
  with chat history has no response model, or has a free-form field
  (``dict`` / ``Any``) that could carry anything, or has a key-like field at all.

Limit: a route without a response model returns whatever its handler builds, and
this test cannot see inside it. Outside the protected routes such routes are
only counted.
"""

import re
import typing
from collections import defaultdict

import pytest
from fastapi import APIRouter
from fastapi.routing import APIRoute
from pydantic import BaseModel

from app.core.environment import auto_include_routers

# Words that mark a field as key-like, matched on the parts of a snake_case name.
SECRET_WORDS = {
    "apikey",
    "authorization",
    "bearer",
    "cookie",
    "credential",
    "credentials",
    "env",
    "key",
    "passwd",
    "password",
    "secret",
    "token",
}
# Whole names that are key-like although none of their parts is a secret word.
SECRET_NAMES = {"config_value", "encrypted_config"}
# A name with one of these parts is a counter, a limit or a flag, not a secret:
# "token_count", "token_limit", "token_type", "has_credentials".
NOT_A_SECRET_WITH = {"count", "has", "limit", "type"}

# Routes that deal with model providers and with the places a provider key used
# to be copied to. For these there are no exceptions at all.
PROTECTED = re.compile(r"^/(model-providers|providers?|provider-models|sync/execution|chat/histor)")

# Protected routes without a response model, each with the reason.
PROTECTED_WITHOUT_MODEL = {
    "DELETE /model-providers/{id}": "answers 204 with an empty body",
    "DELETE /provider/{id}": "answers 204 with an empty body",
    "DELETE /chat/history/{history_id}": "answers 204 with an empty body",
    "POST /provider": "retired: always refuses with 410, never returns a body of its own",
    "PUT /provider/{id}": "retired: always refuses with 410, never returns a body of its own",
}

# Key-like fields that may be returned, with the reason. (model name, field name)
ALLOWED = {
    # --- not a secret: the name only contains the word "key" ---------------
    ("ChatSnapshotOut", "storage_key"): "object path in storage, not a credential",
    ("McpOut", "key"): "catalogue slug of a tool server, typed by an admin",
    ("McpUserOut", "mcp_key"): "catalogue slug of a tool server",
    ("DeviceRegistrationOut", "credential_version"): "a counter that revokes a device; not a credential",
    ("ExecutionIdentity", "device_credential_version"): "a counter that revokes a device; not a credential",
    ("ExecutionConfiguration", "device_credential_version"): "a counter that revokes a device; not a credential",
    # --- a secret this server issues itself and the caller needs -----------
    ("LoginResponse", "token"): "the caller's own session token, returned once at sign-in",
    ("PendingCommandOut", "lease_token"): "one-time lease for a queued command, issued by this server",
    # --- a user's own value that this server stores and returns to them ----
    # They are listed so that this test shows them, and so that a later change
    # to one of them also changes the entry.
    ("ConfigOut", "config_value"): "integration settings; the server uses two of them for Slack triggers",
    ("McpUserOut", "env"): "environment values of the user's tool servers",
    ("RemoteSubAgentProviderOut", "api_key"): "key for an outside agent service",
}

# Fields named "value" are key-like only in these models (the name is too common
# to flag everywhere).
VALUE_IS_SECRET_IN = {"KeyOut"}


def is_key_like(model_name: str, field_name: str) -> bool:
    name = field_name.lower()
    if name in SECRET_NAMES or "api_key" in name:
        return True
    if name == "value":
        return model_name in VALUE_IS_SECRET_IN
    parts = set(name.split("_"))
    return bool(parts & SECRET_WORDS) and not parts & NOT_A_SECRET_WITH


def registered_routes() -> list[APIRoute]:
    router = APIRouter()
    auto_include_routers(router, "", "app/domains")
    auto_include_routers(router, "", "app/api")
    return [route for route in router.routes if isinstance(route, APIRoute)]


def labels(route: APIRoute) -> list[str]:
    return [f"{method} {route.path}" for method in sorted(route.methods)]


def walk(annotation, seen: frozenset = frozenset()):
    """Yield ("field", model name, field name) and ("free_form", model name, field name)."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if annotation in seen:
            return
        seen = seen | {annotation}
        for name, field in annotation.model_fields.items():
            for visible in {name, field.alias or name, field.serialization_alias or name}:
                yield "field", annotation.__name__, visible
            for kind, model, inner in walk(field.annotation, seen):
                # A free-form type found directly in this field belongs to this field.
                yield (kind, annotation.__name__, name) if model is None else (kind, model, inner)
        return
    if annotation in (dict, typing.Any) or typing.get_origin(annotation) is dict:
        yield "free_form", None, None
        return
    for argument in typing.get_args(annotation):
        yield from walk(argument, seen)


@pytest.fixture(scope="module")
def routes() -> list[APIRoute]:
    found = registered_routes()
    # The table is the real one: these routes are mounted by main.py.
    paths = {route.path for route in found}
    assert {"/model-providers", "/providers", "/chat/histories", "/configs"} <= paths
    return found


def test_key_like_response_fields_are_all_explained(routes):
    found = defaultdict(set)
    for route in routes:
        if route.response_model is None:
            continue
        for kind, model, field in walk(route.response_model):
            if kind == "field" and is_key_like(model, field):
                found[(model, field)].update(labels(route))

    unexplained = {entry: sorted(where) for entry, where in found.items() if entry not in ALLOWED}
    assert not unexplained, f"key-like fields a route can return, with no reason given: {unexplained}"

    stale = sorted(set(ALLOWED) - set(found))
    assert not stale, f"ALLOWED lists fields that no route returns any more: {stale}"


def test_provider_and_history_routes_cannot_return_a_key(routes):
    protected = [route for route in routes if PROTECTED.match(route.path)]
    assert len(protected) >= 20

    problems = []
    without_model = set()
    for route in protected:
        if route.response_model is None:
            without_model.update(labels(route))
            continue
        for kind, model, field in walk(route.response_model):
            if kind == "free_form":
                problems.append(f"{labels(route)}: {model}.{field} is free-form")
            elif is_key_like(model, field) and "credential_version" not in field:
                problems.append(f"{labels(route)}: {model}.{field} is key-like")
    assert not problems, problems
    assert without_model == set(PROTECTED_WITHOUT_MODEL)


def test_the_walk_sees_through_pages_lists_and_nested_models():
    class Inner(BaseModel):
        api_key: str

    class Outer(BaseModel):
        items: list[Inner | None]
        extra: dict[str, typing.Any] | None = None

    found = set(walk(Outer))
    assert ("field", "Inner", "api_key") in found
    assert ("free_form", "Outer", "extra") in found


@pytest.mark.parametrize(
    "name,expected",
    [
        ("api_key", True),
        ("openai_api_key", True),
        ("secret_access_key", True),
        ("token", True),
        ("refresh_token", True),
        ("password", True),
        ("env", True),
        ("config_value", True),
        ("encrypted_config", True),
        ("tokens", False),
        ("token_count", False),
        ("token_limit", False),
        ("has_credentials", False),
        ("environment", False),
        ("keyword", False),
    ],
)
def test_key_like_names(name, expected):
    assert is_key_like("AnyModel", name) is expected
