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

from enum import StrEnum

class TriggerType(StrEnum):
    schedule = "schedule"
    webhook = "webhook"
    slack_trigger = "slack_trigger" 


class TriggerStatus(StrEnum):
    pending_verification = "pending_verification"
    inactive = "inactive"
    active = "active"
    stale = "stale"
    completed = "completed"


class ListenerType(StrEnum):
    workforce = "workforce"
    # chat_agent = "chat_agent"

class ExecutionType(StrEnum):
    scheduled = "scheduled"
    webhook = "webhook"
    manual = "manual"
    slack = "slack"

class ExecutionStatus(StrEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    missed = "missed"
    
class RequestType(StrEnum):
    GET = "GET"
    POST = "POST"