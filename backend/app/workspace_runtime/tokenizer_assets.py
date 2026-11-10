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

"""Load explicit, release-pinned assets before enabling managed profiles.

The bundled manifest is application code, never supplied by an HTTP caller.
Release/deployment provisioning places its listed files in an explicit asset
directory. This loader never downloads, searches a tokenizer cache, calls an
encoding registry, or estimates token counts. Missing content disables the
corresponding profile. Querying capability does not invoke this module.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import stat
from pathlib import Path

from .agent_configuration import AgentConfigurationUnavailable
from .agent_model_resources import LoadedOpenAITokenizer

MANIFEST = Path(__file__).with_name("tokenizer_assets.json")
MAX_ASSET_BYTES = 16 * 1024 * 1024


def load_tokenizer_assets(directory: Path):
    from camel.types import UnifiedModelType
    from camel.utils.token_counting import OpenAITokenCounter
    from tiktoken import Encoding

    result = {}
    try:
        manifest = json.loads(MANIFEST.read_bytes())
        if (
            not isinstance(manifest, dict)
            or set(manifest) != {"schema_version", "assets"}
            or manifest["schema_version"] != 1
        ):
            raise ValueError("unsupported release manifest")
        if (
            not isinstance(manifest["assets"], list)
            or len(manifest["assets"]) > 32
        ):
            raise ValueError("invalid asset list")
        directory = Path(directory)
        if not directory.is_absolute():
            raise ValueError("explicit asset directory required")
        root = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except (OSError, ValueError, TypeError, AttributeError):
        return result
    try:
        for entry in manifest["assets"]:
            try:
                if not isinstance(entry, dict) or set(entry) != {
                    "filename",
                    "sha256",
                    "provenance",
                    "encoding_name",
                    "rank_count",
                    "pat_str",
                    "special_tokens",
                    "models",
                }:
                    raise ValueError("unsupported asset manifest")
                if not isinstance(entry["models"], dict) or not isinstance(
                    entry["special_tokens"], dict
                ):
                    raise ValueError("invalid encoding metadata")
                name = entry["filename"]
                if (
                    not isinstance(name, str)
                    or Path(name).name != name
                    or name in {"", ".", ".."}
                ):
                    raise ValueError("invalid asset name")
                fd = os.open(
                    name,
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=root,
                )
                with os.fdopen(fd, "rb") as handle:
                    before = os.fstat(handle.fileno())
                    if (
                        not stat.S_ISREG(before.st_mode)
                        or not 0 < before.st_size <= MAX_ASSET_BYTES
                    ):
                        raise ValueError("invalid asset size/type")
                    raw = handle.read(MAX_ASSET_BYTES + 1)
                    after = os.fstat(handle.fileno())
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (
                    after.st_ino,
                    after.st_size,
                    after.st_mtime_ns,
                ):
                    raise ValueError("asset changed during loading")
                if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                    raise ValueError("asset integrity mismatch")
                ranks = {}
                for line in raw.splitlines():
                    token, number = line.split()
                    token = base64.b64decode(token, validate=True)
                    rank = int(number)
                    if not token or token in ranks or rank < 0:
                        raise ValueError("invalid token rank")
                    ranks[token] = rank
                if len(ranks) != entry["rank_count"] or set(
                    ranks.values()
                ) != set(range(len(ranks))):
                    raise ValueError("incomplete token ranks")
                encoding = Encoding(
                    entry["encoding_name"],
                    pat_str=entry["pat_str"],
                    mergeable_ranks=ranks,
                    special_tokens=entry["special_tokens"],
                )
                loaded = {}
                for model, counters in entry["models"].items():
                    if set(counters) != {
                        "tokens_per_message",
                        "tokens_per_name",
                    } or any(type(v) is not int for v in counters.values()):
                        raise ValueError("invalid counter schema")
                    # Construct the actual CAMEL counter's data-only state.
                    # Its __init__ calls the global tiktoken registry (which
                    # may download); no global monkeypatch is installed here.
                    counter = OpenAITokenCounter.__new__(OpenAITokenCounter)
                    counter.model = UnifiedModelType(model).value_for_tiktoken
                    counter.tokens_per_message = counters["tokens_per_message"]
                    counter.tokens_per_name = counters["tokens_per_name"]
                    counter.encoding = encoding
                    loaded[model] = LoadedOpenAITokenizer(counter)
                if result.keys() & loaded.keys():
                    raise ValueError("duplicate release model")
                result.update(loaded)
            except (
                OSError,
                ValueError,
                TypeError,
                KeyError,
                AgentConfigurationUnavailable,
            ):
                # No filesystem path, raw content or arbitrary parser error
                # crosses the initialization/capability boundary.
                continue
    finally:
        os.close(root)
    return result
