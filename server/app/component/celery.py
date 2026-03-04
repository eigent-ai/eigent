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

from celery import Celery
from app.component.environment import env_or_fail, env

celery = Celery(
    __name__,
    broker=env_or_fail("celery_broker_url"),
    backend=env_or_fail("celery_result_url")
)

# Configure Celery to autodiscover tasks
celery.conf.imports = [
    "app.schedule.trigger_schedule_task",
]

# Configure Celery Beat schedule
ENABLE_TRIGGER_SCHEDULE_POLLER = env("ENABLE_TRIGGER_SCHEDULE_POLLER_TASK", "true").lower() == "true"
TRIGGER_SCHEDULE_POLLER_INTERVAL = int(env("TRIGGER_SCHEDULE_POLLER_INTERVAL", "1"))  # in minutes

ENABLE_EXECUTION_TIMEOUT_CHECKER = env("ENABLE_EXECUTION_TIMEOUT_CHECKER", "true").lower() == "true"
EXECUTION_TIMEOUT_CHECKER_INTERVAL = int(env("EXECUTION_TIMEOUT_CHECKER_INTERVAL", "1"))  # in minutes

celery.conf.beat_schedule = {}

if ENABLE_TRIGGER_SCHEDULE_POLLER:
    celery.conf.beat_schedule["poll-trigger-schedules"] = {
        "task": "app.schedule.trigger_schedule_task.poll_trigger_schedules",
        "schedule": TRIGGER_SCHEDULE_POLLER_INTERVAL * 60.0,  # Convert minutes to seconds
        "options": {"queue": "poll_trigger_schedules"},
    }

if ENABLE_EXECUTION_TIMEOUT_CHECKER:
    celery.conf.beat_schedule["check-execution-timeouts"] = {
        "task": "app.schedule.trigger_schedule_task.check_execution_timeouts",
        "schedule": EXECUTION_TIMEOUT_CHECKER_INTERVAL * 60.0,  # Convert minutes to seconds
        "options": {"queue": "check_execution_timeouts"},
    }

celery.conf.timezone = "UTC"