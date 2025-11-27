from enum import IntEnum, StrEnum


class TriggerType(StrEnum):
    schedule = "schedule"
    webhook = "webhook" 
    slack_trigger = "slack_trigger"


class TriggerStatus(IntEnum):
    inactive = 0
    active = 1
    stale = 2
    completed = 3


class ListenerType(StrEnum):
    workforce = "workforce"
    chat_agent = "chat_agent"


class ExecutionType(StrEnum):
    scheduled = "scheduled"
    webhook = "webhook"
    manual = "manual"
    slack = "slack"


class ExecutionStatus(IntEnum):
    pending = 0
    running = 1
    completed = 2
    failed = 3
    cancelled = 4