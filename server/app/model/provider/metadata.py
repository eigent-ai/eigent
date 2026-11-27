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

"""What this server may know about a user's model provider: non-secret metadata.

A provider's key, cloud access keys, custom headers and any other secret part
of its configuration stay on the user's device. This module is the single place
that decides what may be written to a provider row and what may leave it:

* writes are checked against a fixed list of fields and plain settings; anything
  else is refused, and a refusal names fields only, never a submitted value;
* reads return a stored value only if it would be accepted on write, so a row
  saved by an older client cannot pass a secret through.
"""

import re
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_serializer,
)

MAX_WRITE_BYTES = 16 * 1024

_PROVIDER_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
_SHORT_SETTING = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
_DEPLOYMENT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
_PLAIN_MARKER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")

# Shapes of well-known credentials. This is a second line of defence for text
# fields: the first one is that no field for a credential exists.
_CREDENTIAL_SHAPE = re.compile(
    r"(?i:^(?:sk|pk|rk)[-_])"
    r"|(?i:^(?:bearer|basic)\s)"
    r"|^(?:AKIA|ASIA)[0-9A-Z]{12,}$"
    r"|^AIza[0-9A-Za-z_-]{20,}"
    r"|^gh[pousr]_|^github_pat_"
    r"|^xox[abeprs]-"
    r"|^eyJ[0-9A-Za-z_-]{8,}\."
    r"|^hf_[0-9A-Za-z]{20,}"
    r"|^gsk_|^glpat-"
    r"|-----BEGIN"
)

# Field names a refusal may repeat. A name outside this list was chosen by the
# client, so it is reported as "unknown_field" and never echoed.
_REPORTABLE_REFUSED_NAMES = frozenset(
    {
        "api_key",
        "api_url",
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_session_token",
        "default_headers",
        "encrypted_config",
        "extra_body",
        "extra_headers",
        "headers",
        "id",
        "prefer",
        "url",
        "user_id",
    }
)


def looks_like_credential(value: str) -> bool:
    return bool(_CREDENTIAL_SHAPE.search(value.strip()))


def _has_control_characters(value: str) -> bool:
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


def _provider_name(value: str) -> str:
    if not _PROVIDER_NAME.fullmatch(value) or looks_like_credential(value):
        raise ValueError("not a provider name")
    return value


def _optional_provider_name(value: str) -> str:
    return value if value == "" else _provider_name(value)


def _model_name(value: str) -> str:
    if len(value) > 128 or value != value.strip() or _has_control_characters(value) or looks_like_credential(value):
        raise ValueError("not a model name")
    return value


def _short_setting(value: str) -> str:
    if value and (not _SHORT_SETTING.fullmatch(value) or looks_like_credential(value)):
        raise ValueError("not a plain setting")
    return value


def _deployment_name(value: str) -> str:
    if value and (not _DEPLOYMENT_NAME.fullmatch(value) or looks_like_credential(value)):
        raise ValueError("not a deployment name")
    return value


def _endpoint_url(value: str) -> str:
    """An address the server may keep: no login part, no query, no fragment."""
    if value == "":
        return value
    if len(value) > 512 or value != value.strip() or _has_control_characters(value) or " " in value:
        raise ValueError("not an endpoint address")
    if "?" in value or "#" in value:
        raise ValueError("endpoint address carries a query or fragment")
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 - raises ValueError for an invalid port
    except ValueError:
        raise ValueError("not an endpoint address") from None
    if parts.scheme not in {"http", "https"} or not parts.hostname or "@" in parts.netloc:
        raise ValueError("not an endpoint address without a login part")
    if any(looks_like_credential(segment) for segment in parts.path.split("/")):
        raise ValueError("endpoint address carries a credential")
    return value


ProviderName = Annotated[str, AfterValidator(_provider_name)]
OptionalProviderName = Annotated[str, AfterValidator(_optional_provider_name)]
ModelName = Annotated[str, AfterValidator(_model_name)]
ShortSetting = Annotated[str, AfterValidator(_short_setting)]
DeploymentName = Annotated[str, AfterValidator(_deployment_name)]
EndpointUrl = Annotated[str, AfterValidator(_endpoint_url)]
Number = Annotated[int | float, Field(allow_inf_nan=False)]

_STRICT = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True, protected_namespaces=())


class PlainSettings(BaseModel):
    model_config = _STRICT

    @model_serializer(mode="wrap")
    def _without_unset(self, handler):
        return {name: value for name, value in handler(self).items() if value is not None}


class ModelParameters(PlainSettings):
    """Sampling parameters. Scalars only: no headers, no request bodies."""

    temperature: Number | None = None
    top_p: Number | None = None
    max_tokens: Number | None = None
    max_completion_tokens: Number | None = None
    seed: Number | None = None
    frequency_penalty: Number | None = None
    presence_penalty: Number | None = None
    stream: bool | None = None
    n: Annotated[int, Field(ge=1, le=16)] | None = None
    reasoning_effort: Literal["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] | None = None


class ModelProviderConfig(PlainSettings):
    """Plain provider settings. Every field is listed; there is no free-form part."""

    model_platform: OptionalProviderName | None = None
    model_type: ModelName | None = None
    region_name: ShortSetting | None = None
    api_version: ShortSetting | None = None
    api_mode: ShortSetting | None = None
    azure_deployment_name: DeploymentName | None = None
    timeout: Annotated[int | float, Field(gt=0, le=600, allow_inf_nan=False)] | None = None
    max_retries: Annotated[int, Field(ge=0, le=10)] | None = None
    model_config_dict: ModelParameters | None = None


class ModelProviderWrite(BaseModel):
    """Request body for creating or replacing a provider's metadata."""

    model_config = _STRICT

    provider_name: ProviderName
    model_type: ModelName
    endpoint_url: EndpointUrl = ""
    config: ModelProviderConfig = Field(default_factory=ModelProviderConfig)
    is_valid: Literal[1, 2] = 1

    @field_validator("is_valid", mode="before")
    @classmethod
    def _accept_boolean(cls, value: Any) -> Any:
        if value is True:
            return 2
        if value is False:
            return 1
        return value

    @field_validator("config", mode="before")
    @classmethod
    def _accept_missing_config(cls, value: Any) -> Any:
        return {} if value is None else value

    def to_columns(self) -> dict[str, Any]:
        return {
            "provider_name": self.provider_name,
            "model_type": self.model_type,
            "endpoint_url": self.endpoint_url,
            "encrypted_config": self.config.model_dump(),
            "is_valid": self.is_valid,
        }


class InvalidModelProvider(ValueError):
    """A refused write. Carries field names only."""

    def __init__(self, fields: list[str]):
        super().__init__("invalid model provider")
        self.fields = fields


_NESTED_MODELS: dict[tuple[type[BaseModel], str], type[BaseModel]] = {
    (ModelProviderWrite, "config"): ModelProviderConfig,
    (ModelProviderConfig, "model_config_dict"): ModelParameters,
}


def _refused_field(error: dict[str, Any]) -> str:
    model: type[BaseModel] | None = ModelProviderWrite
    path: list[str] = []
    for part in error.get("loc", ()):
        if model is None or not isinstance(part, str):
            break
        if part in model.model_fields:
            path.append(part)
            model = _NESTED_MODELS.get((model, part))
            continue
        if error.get("type") == "extra_forbidden":
            path.append(part if part in _REPORTABLE_REFUSED_NAMES else "unknown_field")
        break
    return ".".join(path) or "body"


def parse_model_provider_write(payload: Any) -> ModelProviderWrite:
    """Validate a write. On refusal the error names fields and holds no input."""
    if not isinstance(payload, dict):
        raise InvalidModelProvider(["body"])
    try:
        return ModelProviderWrite.model_validate(payload)
    except ValidationError as error:
        fields = sorted({_refused_field(item) for item in error.errors(include_input=False, include_context=False)})
        raise InvalidModelProvider(fields) from None


def _accepted(check, value: Any) -> str:
    if not isinstance(value, str):
        return ""
    try:
        return check(value)
    except ValueError:
        return ""


def stored_provider_name(value: Any) -> str:
    return _accepted(_provider_name, value)


def stored_model_type(value: Any) -> str:
    return _accepted(_model_name, value)


def stored_endpoint_url(value: Any) -> str:
    return _accepted(_endpoint_url, value)


def _accepted_settings(model: type[PlainSettings], value: Any, nested: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    kept: dict[str, Any] = {}
    for name in model.model_fields:
        if name not in value or value[name] is None:
            continue
        item = nested[name] if nested and name in nested else value[name]
        try:
            model.model_validate({name: item})
        except ValidationError:
            continue
        kept[name] = item
    return kept


def stored_config(value: Any) -> ModelProviderConfig:
    """Keep the allowed settings of a stored row and leave everything else out."""
    if not isinstance(value, dict):
        return ModelProviderConfig()
    parameters = _accepted_settings(ModelParameters, value.get("model_config_dict"))
    kept = _accepted_settings(ModelProviderConfig, value, {"model_config_dict": parameters})
    if not parameters:
        kept.pop("model_config_dict", None)
    return ModelProviderConfig.model_validate(kept)


def public_address(value: Any) -> str:
    """Reduce an address to scheme, host, port and path.

    Used where an address is kept only as a label (the chat history's
    ``api_url``). A plain marker such as ``cloud`` is kept as it is.
    """
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text or len(text) > 2048 or _has_control_characters(text):
        return ""
    if "://" not in text:
        return text if _PLAIN_MARKER.fullmatch(text) and not looks_like_credential(text) else ""
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ""
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    netloc = f"{host}:{port}" if port is not None else host
    path = parts.path
    if " " in path or any(looks_like_credential(segment) for segment in path.split("/")):
        path = ""
    return urlunsplit((parts.scheme, netloc, path, "", ""))[:500]
