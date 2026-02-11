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
App Trigger Configuration Models

This package contains configuration models for different trigger app types.
"""

from app.model.trigger.app_configs.base_config import (
    BaseTriggerConfig,
    ActivationError,
)
from app.model.trigger.app_configs.slack_config import (
    SlackEventType,
    SlackTriggerConfig,
)
from app.model.trigger.app_configs.webhook_config import (
    WebhookTriggerConfig,
)
from app.model.trigger.app_configs.schedule_config import (
    ScheduleTriggerConfig,
)
from app.model.trigger.app_configs.config_registry import (
    get_config_class,
    get_config_schema,
    validate_config,
    register_config_class,
    get_supported_config_types,
    has_config,
    validate_activation,
)

__all__ = [
    # Base config
    "BaseTriggerConfig",
    "ActivationError",
    # Slack config
    "SlackEventType",
    "SlackTriggerConfig",
    # Webhook config
    "WebhookTriggerConfig",
    # Schedule config
    "ScheduleTriggerConfig",
    # Registry functions
    "get_config_class",
    "get_config_schema",
    "validate_config",
    "register_config_class",
    "get_supported_config_types",
    "has_config",
    "validate_activation",
]