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

"""
Shared Model Backend Registry
==============================

Deduplicates ModelFactory.create() calls by caching model backends
keyed on their configuration fingerprint (platform + type + url + key hash
+ model_config). Agents with identical configs share the same backend.
"""

import hmac
import logging
import threading
from typing import Any

from camel.models import ModelFactory

logger = logging.getLogger("model_registry")

_model_registry: dict[str, Any] = {}
_registry_lock = threading.Lock()


def _compute_fingerprint(
    model_platform: str,
    model_type: str,
    api_key: str | None = None,
    api_url: str | None = None,
    model_config_dict: dict | None = None,
) -> str:
    # HMAC for cache-key derivation (not password storage — safe to use here)
    key_hash = hmac.new(
        b"model-registry", (api_key or "").encode(), "sha256"
    ).hexdigest()[:16]
    config_str = ""
    if model_config_dict:
        # Exclude "user" (project_id for API tracking) from fingerprint
        # so all projects share the same model backend
        filtered = {k: v for k, v in model_config_dict.items() if k != "user"}
        if filtered:
            config_str = str(sorted(filtered.items()))
    raw = f"{model_platform}|{model_type}|{api_url or ''}|{key_hash}|{config_str}"
    return hmac.new(b"model-registry", raw.encode(), "sha256").hexdigest()[:32]


def get_or_create_model(
    model_platform: str,
    model_type: str,
    api_key: str | None = None,
    api_url: str | None = None,
    model_config_dict: dict | None = None,
    timeout: int = 600,
    **init_params: Any,
) -> Any:
    """Drop-in replacement for ModelFactory.create() with caching."""
    fingerprint = _compute_fingerprint(
        model_platform=model_platform,
        model_type=model_type,
        api_key=api_key,
        api_url=api_url,
        model_config_dict=model_config_dict,
    )

    with _registry_lock:
        if fingerprint in _model_registry:
            logger.debug(
                f"Reusing cached model backend: "
                f"platform={model_platform}, type={model_type} "
                f"(fingerprint={fingerprint[:8]}...)"
            )
            return _model_registry[fingerprint]

    # Create outside the lock to avoid blocking during network calls
    logger.info(
        f"Creating new model backend: "
        f"platform={model_platform}, type={model_type}, url={api_url} "
        f"(fingerprint={fingerprint[:8]}...)"
    )
    model = ModelFactory.create(
        model_platform=model_platform,
        model_type=model_type,
        api_key=api_key,
        url=api_url,
        model_config_dict=model_config_dict or None,
        timeout=timeout,
        **init_params,
    )

    with _registry_lock:
        if fingerprint not in _model_registry:
            _model_registry[fingerprint] = model
            logger.info(
                f"Registered model backend (total: {len(_model_registry)}): "
                f"platform={model_platform}, type={model_type}"
            )
        else:
            model = _model_registry[fingerprint]

    return model


def clear_registry() -> None:
    """Clear all cached model backends (e.g. on shutdown or key rotation)."""
    with _registry_lock:
        count = len(_model_registry)
        _model_registry.clear()
        logger.info(f"Model registry cleared ({count} models removed)")
