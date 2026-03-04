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
Trigger Service Package

Contains services for managing triggers including:
- TriggerService: Main service for trigger operations
- TriggerScheduleService: Service for scheduled trigger operations
- App Handlers: Handlers for different trigger types (Slack, Webhook, Schedule)
"""

from app.service.trigger.trigger_service import TriggerService, get_trigger_service
from app.service.trigger.trigger_schedule_service import TriggerScheduleService
from app.service.trigger.app_handler_service import (
    BaseAppHandler,
    SlackAppHandler,
    DefaultWebhookHandler,
    ScheduleAppHandler,
    AppHandlerResult,
    get_app_handler,
    get_schedule_handler,
    register_app_handler,
    get_supported_trigger_types,
)

__all__ = [
    # Services
    "TriggerService",
    "get_trigger_service",
    "TriggerScheduleService",
    # Handlers
    "BaseAppHandler",
    "SlackAppHandler",
    "DefaultWebhookHandler",
    "ScheduleAppHandler",
    "AppHandlerResult",
    # Handler functions
    "get_app_handler",
    "get_schedule_handler",
    "register_app_handler",
    "get_supported_trigger_types",
]