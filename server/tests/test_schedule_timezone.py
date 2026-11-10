import importlib.util
from pathlib import Path
from datetime import datetime, timezone
import pytest

path = Path(__file__).parents[1] / "app/core/schedule_time.py"
spec = importlib.util.spec_from_file_location("schedule_time", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
next_schedule_time = module.next_schedule_time


@pytest.mark.parametrize(
    "zone,before,expected",
    [
        ("Europe/London", "2026-03-28T14:00:00+00:00", "2026-03-29T12:20:00+00:00"),
        ("Europe/London", "2026-10-24T14:00:00+00:00", "2026-10-25T13:20:00+00:00"),
        ("America/New_York", "2026-03-07T20:00:00+00:00", "2026-03-08T17:20:00+00:00"),
        ("America/New_York", "2026-10-31T20:00:00+00:00", "2026-11-01T18:20:00+00:00"),
    ],
)
def test_daily_wall_time_survives_dst(zone, before, expected):
    assert next_schedule_time(
        "20 13 * * *", datetime.fromisoformat(before), {"timezone": zone}
    ) == datetime.fromisoformat(expected)


def test_legacy_schedules_keep_utc():
    assert next_schedule_time("20 13 * * *", datetime(2026, 10, 24, 14, tzinfo=timezone.utc)) == datetime(
        2026, 10, 25, 13, 20, tzinfo=timezone.utc
    )


def test_one_time_date_keeps_year_and_zone():
    assert next_schedule_time(
        "20 13 25 10 *", datetime(2026, 1, 1, tzinfo=timezone.utc), {"timezone": "Europe/London", "date": "2027-10-25"}
    ) == datetime(2027, 10, 25, 12, 20, tzinfo=timezone.utc)


def test_spring_gap_is_skipped_and_fall_hour_executes_once():
    config = {"timezone": "Europe/London"}
    assert next_schedule_time("30 1 * * *", datetime(2026, 3, 28, 2, tzinfo=timezone.utc), config) == datetime(
        2026, 3, 30, 0, 30, tzinfo=timezone.utc
    )
    assert next_schedule_time("30 1 * * *", datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc), config) == datetime(
        2026, 10, 26, 1, 30, tzinfo=timezone.utc
    )


def load_schedule_config():
    import ast
    from typing import Optional, Tuple
    from pydantic import BaseModel, Field, field_validator
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    path = Path(__file__).parents[1] / "app/model/trigger/app_configs/schedule_config.py"
    tree = ast.parse(path.read_text())
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ScheduleTriggerConfig")
    namespace = dict(
        BaseTriggerConfig=BaseModel,
        Field=Field,
        field_validator=field_validator,
        Optional=Optional,
        Tuple=Tuple,
        datetime=datetime,
        timezone=timezone,
        ZoneInfo=ZoneInfo,
        ZoneInfoNotFoundError=ZoneInfoNotFoundError,
    )
    exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])), str(path), "exec"), namespace)
    return namespace["ScheduleTriggerConfig"]


def test_zone_validation_and_expiration_use_the_same_calendar():
    Config = load_schedule_config()
    with pytest.raises(ValueError):
        Config(timezone="invalid/zone")
    config = Config(timezone="America/New_York", expirationDate="2026-10-25")
    assert not config.is_expired(datetime(2026, 10, 26, 3, tzinfo=timezone.utc))
    assert config.is_expired(datetime(2026, 10, 26, 5, tzinfo=timezone.utc))
    assert Config(expirationDate="2026-10-25").is_expired(datetime(2026, 10, 26, 0, 1, tzinfo=timezone.utc))
    assert not Config(timezone="America/New_York", date="2026-10-25").is_expired(
        datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    )


@pytest.mark.parametrize(
    "relative",
    ["app/domains/trigger/service/trigger_schedule_service.py"],
)
def test_both_services_evaluate_the_saved_zone(relative):
    import ast
    from typing import Optional
    from types import SimpleNamespace

    path = Path(__file__).parents[1] / relative
    tree = ast.parse(path.read_text())
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "TriggerScheduleService")
    method = next(
        node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "calculate_next_run_at"
    )
    for arg in method.args.args:
        arg.annotation = None
    method.returns = None
    namespace = dict(
        datetime=datetime,
        timezone=timezone,
        next_schedule_time=next_schedule_time,
        logger=SimpleNamespace(error=lambda *a, **k: None),
    )
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), str(path), "exec"), namespace)
    trigger = SimpleNamespace(id=1, custom_cron_expression="20 13 * * *", config={"timezone": "Europe/London"})
    assert namespace["calculate_next_run_at"](
        None, trigger, datetime(2026, 10, 24, 14, tzinfo=timezone.utc)
    ) == datetime(2026, 10, 25, 13, 20, tzinfo=timezone.utc)
