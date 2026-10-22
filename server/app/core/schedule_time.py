"""Cron wall times are local only when a schedule explicitly names a zone."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from croniter import croniter


def next_schedule_time(expression: str, base: datetime, config: dict | None = None) -> datetime:
    config = config or {}
    name = config.get("timezone")
    if not name:
        return croniter(expression, base).get_next(datetime)
    zone = ZoneInfo(name)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    local_base = base.astimezone(zone).replace(tzinfo=None)
    chosen_date = config.get("date")
    if chosen_date:
        midnight = datetime.strptime(chosen_date, "%Y-%m-%d")
        local_base = max(local_base, midnight - timedelta(seconds=1))
    cron = croniter(expression, local_base)
    # Iterate in wall time so a DST change does not shift the chosen hour.
    # Nonexistent wall times are skipped; ambiguous times execute once.
    for _ in range(400):
        wall = cron.get_next(datetime)
        if chosen_date and wall.date().isoformat() != chosen_date:
            raise ValueError("One-time schedule has no future match on its date")
        candidate = wall.replace(tzinfo=zone, fold=0).astimezone(timezone.utc)
        if candidate > base and candidate.astimezone(zone).replace(tzinfo=None) == wall:
            return candidate
    raise ValueError("No valid local schedule occurrence")
