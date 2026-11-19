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

import asyncio
import atexit
import os
import pathlib
import signal
import sys
import threading

# Add project root to Python path to import shared utils
_project_root = pathlib.Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

# Disable verbose CAMEL logs
logging.getLogger("camel").setLevel(logging.WARNING)
logging.getLogger("camel.base_model").setLevel(logging.WARNING)
logging.getLogger("camel.agents").setLevel(logging.WARNING)
logging.getLogger("camel.societies").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


def _enable_system_trust_store() -> None:
    try:
        import truststore

        truststore.inject_into_ssl()
        logging.getLogger("main").info("System trust store enabled")
    except Exception:
        logging.getLogger("main").warning(
            "Failed to enable system trust store; falling back to default CA bundle",
            exc_info=True,
        )


_enable_system_trust_store()

from app.auth.local_control import capture_local_control_capability

# Electron passes this once at process creation. Consume it before routers,
# toolkits, or model-controlled subprocesses can inspect the Brain environment.
capture_local_control_capability()

from app import api
from app.component.environment import env
from app.router import register_routers
from app.run_sync.middleware import cloud_sync_configuration_middleware
from app.utils.event_loop_utils import set_main_event_loop

os.environ["PYTHONIOENCODING"] = "utf-8"
_fallback_camel_log_dir = (
    pathlib.Path.home() / ".eigent" / "fallback" / "camel_logs"
)
_fallback_camel_log_dir.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("CAMEL_LOG_DIR", str(_fallback_camel_log_dir))

app_logger = logging.getLogger("main")

api.middleware("http")(cloud_sync_configuration_middleware)

# Log application startup
app_logger.info("Starting Eigent Multi-Agent System API")
app_logger.info(f"Python encoding: {os.environ.get('PYTHONIOENCODING')}")
app_logger.info(f"Environment: {os.environ.get('ENVIRONMENT', 'development')}")

prefix = env("url_prefix", "")
app_logger.info(f"Loading routers with prefix: '{prefix}'")
app_logger.info(
    f"MCP will be at: {prefix}/mcp/list, health at: {prefix}/health"
)
register_routers(api, prefix)
app_logger.info("All routers loaded successfully")

# Check if debug mode is enabled via environment variable
if os.environ.get("ENABLE_PYTHON_DEBUG") == "true":
    try:
        import debugpy

        DEBUG_PORT = int(os.environ.get("DEBUG_PORT", "5678"))
        app_logger.info(
            f"Debug mode enabled - Starting debugpy server on port {DEBUG_PORT}"
        )
        debugpy.listen(("localhost", DEBUG_PORT))
        app_logger.info(
            f"Debugger ready for attachment on localhost:{DEBUG_PORT}"
        )
        # 📝 In VS Code: Run 'Debug Python Backend (Attach)' configuration
        # Don't wait for client automatically - let it attach when ready
    except ImportError:
        app_logger.warning(
            "debugpy not available, install with: uv add debugpy"
        )
    except Exception as e:
        app_logger.error(f"Failed to start debugpy: {e}")

dir = pathlib.Path(__file__).parent / "runtime"
dir.mkdir(parents=True, exist_ok=True)


# Write PID file asynchronously
async def write_pid_file():
    r"""Write PID file asynchronously"""
    import aiofiles

    async with aiofiles.open(dir / "run.pid", "w") as f:
        await f.write(str(os.getpid()))
    app_logger.info(f"PID file written: {os.getpid()}")


# PID task will be created on startup
pid_task = None


journal_claim_task = None


async def _claim_journal_when_free(journal_path) -> None:
    """Take over journal ownership once the other Brain has exited.

    Without it, the next Brain to start would become the owner and
    interrupt this one's running Tasks.
    """

    from app.run_journal.instance_lock import acquire_journal_instance_lock

    while True:
        await asyncio.sleep(5)
        if await asyncio.to_thread(
            acquire_journal_instance_lock, journal_path
        ):
            app_logger.info("This Brain now owns %s", journal_path)
            return


async def _reconcile_durable_state(journal) -> None:
    """Settle what a stopped Brain left behind. Journal owner only."""

    from app.artifacts import finalize_recoverable_run_artifacts

    artifact_recovery = await asyncio.to_thread(
        finalize_recoverable_run_artifacts,
        journal,
    )

    reconciliation = await asyncio.to_thread(journal.reconcile_startup)
    from app.workspace_git.scheduler import (
        get_default_workspace_writer_scheduler,
    )
    from app.workspace_git.startup import reconcile_workspace_git_startup

    writer_scheduler = get_default_workspace_writer_scheduler()
    writer_reconciliation = await asyncio.to_thread(
        writer_scheduler.reconcile_orphaned_admissions
    )
    workspace_git_reconciliation = await asyncio.to_thread(
        reconcile_workspace_git_startup,
        journal,
    )
    # Git reconciliation settles interrupted writes before holders are judged.
    writer_reclamation = await asyncio.to_thread(
        writer_scheduler.reclaim_lost_writers
    )
    from app.lightweight_memory import migrate_legacy_memory_v1_on_startup
    from app.workspace_config.legacy_migration import (
        migrate_legacy_workspace_bundle_on_startup,
    )

    legacy_bundle_migration = await asyncio.to_thread(
        migrate_legacy_workspace_bundle_on_startup,
        journal,
    )
    if legacy_bundle_migration.status == "degraded":
        app_logger.warning(
            "Legacy Workspace Bundle migration degraded without blocking "
            "startup: %s",
            legacy_bundle_migration.error,
        )
    legacy_memory_migration = await asyncio.to_thread(
        migrate_legacy_memory_v1_on_startup
    )
    if legacy_memory_migration.status == "degraded":
        app_logger.warning(
            "Legacy Memory V1 migration degraded without blocking startup: "
            "%s files",
            legacy_memory_migration.degraded_files,
        )
    app_logger.info(
        "RunJournal startup reconciliation complete",
        extra={
            "recovered_artifact_manifests": len(artifact_recovery),
            "interrupted_runs": len(reconciliation.interrupted_run_ids),
            "completed_cancels": len(reconciliation.completed_cancel_run_ids),
            "deadline_runs": len(reconciliation.deadline_run_ids),
            "detached_attempts": len(reconciliation.detached_attempt_ids),
            "outcome_unknown_tools": len(
                reconciliation.outcome_unknown_tool_call_ids
            ),
            "outcome_unknown_model_invocations": len(
                reconciliation.outcome_unknown_model_invocation_ids
            ),
            "pending_approvals": len(reconciliation.pending_approval_ids),
            "interrupted_orphaned_workspace_writers": len(
                writer_reconciliation.interrupted_request_ids
            ),
            "reclaimed_workspace_writers": len(
                writer_reclamation.reclaimed_request_ids
            ),
            "promoted_workspace_writers": len(
                writer_reconciliation.promoted_request_ids
            )
            + len(writer_reclamation.promoted_request_ids),
            "preserved_workspace_writers": len(
                writer_reconciliation.preserved_request_ids
            ),
            "workspace_writer_reconciliation_failures": len(
                writer_reconciliation.failed_request_ids
            )
            + len(writer_reclamation.failed_request_ids),
            "workspace_git_reconciliation_skipped": (
                workspace_git_reconciliation.skipped
            ),
            "workspace_git_reconciliation_skip_reason": (
                workspace_git_reconciliation.skipped_reason
            ),
            "recovered_agent_workspaces": len(
                workspace_git_reconciliation.workforce.recovered_workspace_ids
            ),
            "agent_workspaces_needing_attention": len(
                workspace_git_reconciliation.workforce.needs_attention_workspace_ids
            ),
            "reconcilable_commands": len(
                reconciliation.reconcilable_command_ids
            ),
            "recovered_git_change_sets": len(
                workspace_git_reconciliation.mutations.recovered_change_set_ids
            ),
            "git_change_sets_needing_attention": len(
                workspace_git_reconciliation.mutations.needs_attention_change_set_ids
            ),
            "finalized_terminal_git_runs": len(
                workspace_git_reconciliation.terminal.finalizations
            ),
            "terminal_git_finalization_failures": len(
                workspace_git_reconciliation.terminal.failed_run_ids
            ),
            "external_git_changes": len(
                workspace_git_reconciliation.observation.changes
            ),
            "git_observation_failures": len(
                workspace_git_reconciliation.observation.failed_repository_ids
            ),
            "legacy_memory_imported": (legacy_memory_migration.imported_count),
            "legacy_memory_skipped": legacy_memory_migration.skipped_count,
        },
    )


@api.on_event("startup")
async def startup_event():
    global pid_task, journal_claim_task
    set_main_event_loop(asyncio.get_running_loop())
    pid_task = asyncio.create_task(write_pid_file())
    app_logger.info("PID write task created")

    from app.auth.cli_access import initialize_cli_access
    from app.run_journal.instance_lock import (
        acquire_journal_instance_lock,
        journal_instance_owner_pid,
    )
    from app.run_journal.runtime import (
        configured_run_journal_path,
        get_default_run_journal,
    )

    # One Brain owns a RunJournal. Reconciliation below would interrupt the
    # running Tasks of any other Brain that has the same journal open.
    journal_path = configured_run_journal_path()
    owns_journal = await asyncio.to_thread(
        acquire_journal_instance_lock, journal_path, wait_seconds=3.0
    )
    if not owns_journal:
        owner_pid = journal_instance_owner_pid(journal_path)
        if env("EIGENT_RUNTIME", "").lower().strip() != "electron":
            raise RuntimeError(
                "Another Eigent process"
                + (f" (pid {owner_pid})" if owner_pid else "")
                + f" is already using {journal_path}. Stop it first, or "
                "point this one at a different EIGENT_RUN_JOURNAL_PATH."
            )
        # The desktop app keeps starting, so a leftover backend process
        # cannot lock the user out of the app. It leaves the other
        # process's Tasks alone instead.
        app_logger.warning(
            "Another Eigent process (pid %s) owns %s; skipping startup "
            "reconciliation",
            owner_pid,
            journal_path,
        )

        journal_claim_task = asyncio.create_task(
            _claim_journal_when_free(journal_path)
        )

    initialize_cli_access()

    # Reconcile durable execution facts before accepting new Run admission.
    # No Python coroutine or external Tool call is restarted implicitly.
    journal = get_default_run_journal()
    if owns_journal:
        await _reconcile_durable_state(journal)

    # Initialize EnvironmentHands from Brain deployment (full on local/cloud_vm, sandbox in Docker)
    from app.router_layer.hands_resolver import init_environment_hands

    hands = init_environment_hands()
    app_logger.info(f"EnvironmentHands initialized: mode={hands.mode}")

    # Initialize telemetry tracer provider
    from app.utils.telemetry.workforce_metrics import (
        initialize_tracer_provider,
    )

    initialize_tracer_provider()
    app_logger.info("Telemetry tracer provider initialized")

    # Optional isolated owners start only after durable fact reconciliation.
    # Deployment registration supplies explicit policies and worker adapters.
    from app.workspace_runtime.runtime import (
        initialize_execution_service,
        start_default_execution_service,
    )

    initialize_execution_service(env("EIGENT_MANAGED_EXECUTION_MANIFEST", ""))
    await start_default_execution_service()
    from app.utils.runtime_environment_cleanup import (
        runtime_environment_gc_loop,
    )

    global runtime_environment_gc_task
    runtime_environment_gc_task = asyncio.create_task(
        runtime_environment_gc_loop(journal)
    )

    # Queued Tasks of Sessions the Brain started have no renderer to
    # dispatch them. Starts after reconciliation, like every other admission.
    from app.dispatch.service import DISPATCHER

    DISPATCHER.start()


@api.on_event("shutdown")
async def shutdown_event_handler():
    r"""Run cleanup when uvicorn receives SIGINT/SIGTERM and shuts down."""
    await cleanup_resources()


async def cleanup_resources():
    r"""Cleanup all resources on shutdown"""
    from app.auth.cli_access import shutdown_cli_access

    shutdown_cli_access()
    from app.dispatch.service import DISPATCHER

    await DISPATCHER.stop()
    claim_task = globals().get("journal_claim_task")
    if claim_task is not None:
        claim_task.cancel()
        await asyncio.gather(claim_task, return_exceptions=True)
    gc_task = globals().get("runtime_environment_gc_task")
    if gc_task is not None:
        gc_task.cancel()
        await asyncio.gather(gc_task, return_exceptions=True)
    app_logger.info("Starting graceful shutdown process")

    from app.run_runtime.runtime import mark_process_shutting_down

    # Quitting is not a tool outcome: undispatched tools and their approvals
    # stay open so restart recovery records the interruption.
    mark_process_shutting_down()

    from app.workspace_runtime.runtime import close_default_execution_service

    # Stop new claims and drain owned preparation/execution before the shared
    # coordinator, compatibility resources or journal are closed.
    await close_default_execution_service()

    # Stop detached execution consumers before cleaning their compatibility
    # TaskLocks. RunJournal remains open until all producers have stopped.
    try:
        from app.run_runtime import close_default_run_coordinator

        await close_default_run_coordinator()
    except Exception as e:
        app_logger.warning(f"RunCoordinator shutdown failed: {e}")

    # Stop cloud outbox drain before closing its shared SQLite journal.
    try:
        from app.run_sync.runtime import close_default_cloud_sync_worker

        await close_default_cloud_sync_worker()
    except Exception as e:
        app_logger.warning(f"CloudSyncWorker shutdown failed: {e}")

    from app.service.task import _cleanup_task, task_locks

    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass

    # Cleanup all task locks. Runs still active here become interrupted on
    # the next start, so keep their environment copies for Resume.
    for task_id in list(task_locks.keys()):
        try:
            task_lock = task_locks[task_id]
            await task_lock.cleanup(keep_run_environments=True)
        except Exception as e:
            app_logger.error(f"Error cleaning up task {task_id}: {e}")

    # Close the process-owned SQLite RunJournal after producers have stopped.
    try:
        from app.run_journal.runtime import close_default_run_journal

        close_default_run_journal()
    except Exception as e:
        app_logger.warning(f"RunJournal shutdown failed: {e}")
    from app.run_journal.instance_lock import release_journal_instance_locks

    release_journal_instance_locks()

    # Remove PID file
    pid_file = dir / "run.pid"
    if pid_file.exists():
        pid_file.unlink()

    # Shutdown OpenTelemetry tracer (releases BatchSpanProcessor worker threads)
    try:
        from app.utils.telemetry.workforce_metrics import (
            shutdown_tracer_provider,
        )

        shutdown_tracer_provider()
    except Exception as e:
        app_logger.warning(f"Telemetry shutdown failed: {e}")

    # Shutdown TerminalToolkit thread pool (prevents non-daemon threads blocking exit)
    try:
        from app.agent.toolkit.terminal_toolkit import TerminalToolkit

        if TerminalToolkit._thread_pool is not None:
            TerminalToolkit._thread_pool.shutdown(wait=False)
            TerminalToolkit._thread_pool = None
    except Exception as e:
        app_logger.warning(f"TerminalToolkit shutdown failed: {e}")

    # Best-effort close Browser toolkit WebSocket/Node connections.
    # Use a timeout so shutdown stays responsive even if a wrapper is stuck.
    try:
        from app.agent.toolkit.hybrid_browser_toolkit import (
            websocket_connection_pool,
        )

        await asyncio.wait_for(
            websocket_connection_pool.close_all(), timeout=3.0
        )
    except TimeoutError:
        app_logger.warning("Browser WebSocket pool shutdown timed out")
    except Exception as e:
        app_logger.warning(f"Browser WebSocket pool shutdown failed: {e}")

    set_main_event_loop(None)
    app_logger.info("All resources cleaned up successfully")


# Register cleanup on exit with safe synchronous wrapper
def sync_cleanup():
    """Synchronous cleanup for atexit - handles PID file removal"""
    try:
        # Only perform synchronous cleanup tasks
        pid_file = dir / "run.pid"
        if pid_file.exists():
            pid_file.unlink()
            app_logger.info("PID file removed during shutdown")
    except Exception as e:
        app_logger.error(f"Error during atexit cleanup: {e}")


atexit.register(sync_cleanup)

# Log successful initialization
app_logger.info("Application initialization completed successfully")

DEFAULT_BRAIN_HOST = "127.0.0.1"


def run_standalone():
    """Run Brain in standalone mode (no Electron dependency)."""
    import uvicorn

    port = int(env("EIGENT_BRAIN_PORT", "5001"))
    # Exposing Brain is an explicit deployment choice. Desktop and local dev
    # default to loopback so LAN peers cannot reach mutable Chat/Run APIs.
    host = env("EIGENT_BRAIN_HOST", DEFAULT_BRAIN_HOST)
    reload = os.environ.get("EIGENT_DEBUG", "").lower() in ("1", "true", "yes")

    app_logger.info(
        f"Starting Brain in standalone mode: {host}:{port} (reload={reload})"
    )
    if reload:
        uvicorn.run(
            "main:api",
            host=host,
            port=port,
            reload=reload,
            timeout_graceful_shutdown=5,
        )
        return

    config = uvicorn.Config(
        "main:api",
        host=host,
        port=port,
        reload=False,
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None

    from app.dispatch.lifecycle import register_shutdown_handler

    # Lets ``eigent brain stop`` end a background Brain gracefully.
    register_shutdown_handler(lambda: setattr(server, "should_exit", True))

    force_exit_timer = None
    signal_count = {"count": 0}
    old_sigint = signal.getsignal(signal.SIGINT)
    old_sigterm = signal.getsignal(signal.SIGTERM)

    def _force_exit(signum: int):
        signame = signal.Signals(signum).name
        app_logger.error(
            "Force exiting Brain after %s because graceful shutdown did not finish",
            signame,
        )
        os._exit(128 + signum)

    def _handle_signal(signum, _frame):
        nonlocal force_exit_timer
        signame = signal.Signals(signum).name
        signal_count["count"] += 1

        if signal_count["count"] == 1:
            app_logger.warning(
                "%s received, requesting graceful shutdown. Press Ctrl+C again to force exit.",
                signame,
            )
            server.should_exit = True
            if force_exit_timer is None:
                force_exit_timer = threading.Timer(
                    5.0, _force_exit, args=(signum,)
                )
                force_exit_timer.daemon = True
                force_exit_timer.start()
            return

        app_logger.error(
            "%s received again, force exiting Brain immediately", signame
        )
        _force_exit(signum)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    try:
        server.run()
    finally:
        if force_exit_timer is not None:
            force_exit_timer.cancel()
        signal.signal(signal.SIGINT, old_sigint)
        signal.signal(signal.SIGTERM, old_sigterm)
    if not server.started:
        # For example, another Eigent already owns the RunJournal. A
        # launcher must be able to tell this from a normal stop.
        sys.exit(3)


if __name__ == "__main__":
    run_standalone()
