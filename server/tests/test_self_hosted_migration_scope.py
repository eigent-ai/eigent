import ast
from pathlib import Path

from fastapi import FastAPI

MIGRATED_MODULES = (
    "app/domains/remote_control/api/command_control_controller.py",
    "app/domains/remote_control/service/command_control_service.py",
    "app/domains/remote_control/service/command_notifier.py",
    "app/model/remote_control/command_control.py",
    "alembic/versions/2026_08_27_1200-add_self_hosted_remote_command_control.py",
)

EXCLUDED_MARKERS = (
    "step_sync",
    "run_sync_service",
    "workspace_bundle",
    "s3",
    "cloud_model",
    "credit",
    "stripe",
    "artifact_upload",
    "file_sync",
    "memory_sync",
    "environment_spec",
)


def test_migrated_control_plane_has_no_hosted_sync_dependencies(
    server_root: Path,
) -> None:
    for relative_path in MIGRATED_MODULES:
        source = (server_root / relative_path).read_text().lower()
        for marker in EXCLUDED_MARKERS:
            assert marker not in source, f"{relative_path} unexpectedly contains excluded marker {marker!r}"


def _migration_revisions(
    path: Path,
) -> tuple[str, str | tuple[str, ...] | None]:
    tree = ast.parse(path.read_text())
    values: dict[str, str | None] = {}
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        if node.target.id not in {"revision", "down_revision"}:
            continue
        values[node.target.id] = ast.literal_eval(node.value)
    return values["revision"], values["down_revision"]


def test_hosted_database_revision_rejoins_self_hosted_chain(
    server_root: Path,
) -> None:
    versions = server_root / "alembic/versions"
    marker = versions / "2026_06_10_1200-hosted_schema_compatibility_marker.py"
    command_control = versions / "2026_08_27_1200-add_self_hosted_remote_command_control.py"
    lineage_merge = versions / "2026_08_27_1230-merge_self_hosted_remote_command_lineages.py"

    assert _migration_revisions(marker) == (
        "add_cloud_model_table",
        "add_rc_space_scope",
    )
    assert _migration_revisions(command_control) == (
        "add_self_hosted_rc_control",
        "add_rc_space_scope",
    )
    assert _migration_revisions(lineage_merge) == (
        "merge_self_hosted_rc_lineages",
        ("add_cloud_model_table", "add_self_hosted_rc_control"),
    )
    assert "op." not in marker.read_text()
    assert "op." not in lineage_merge.read_text()


def test_self_hosted_server_does_not_expose_run_or_step_sync_routes(
    server_root: Path,
) -> None:
    controller = (server_root / "app/domains/remote_control/api/command_control_controller.py").read_text()

    assert 'router = APIRouter(prefix="/sync"' in controller
    assert '"/commands/pending"' in controller
    assert '"/runs/' not in controller
    assert '"/steps/' not in controller
    assert '"/files/' not in controller


def test_command_control_routes_load_through_server_discovery(server_root: Path, monkeypatch) -> None:
    monkeypatch.setenv("database_url", "sqlite:///test.db")
    monkeypatch.setenv("secret_key", "test-secret")
    monkeypatch.setenv("redis_url", "redis://localhost:6379/0")
    monkeypatch.setenv("celery_broker_url", "redis://localhost:6379/0")
    monkeypatch.setenv("celery_result_url", "redis://localhost:6379/0")

    from app.core.environment import auto_include_routers

    api = FastAPI()
    auto_include_routers(
        api,
        "",
        str(server_root / "app/domains/remote_control/api"),
    )
    route_paths = {route.path for route in api.routes}

    assert "/sync/devices/register" in route_paths
    assert "/sync/commands/pending" in route_paths
    assert "/sync/commands/{command_id}/confirm-receipt" in route_paths
    assert "/sync/commands/{command_id}/events" in route_paths
