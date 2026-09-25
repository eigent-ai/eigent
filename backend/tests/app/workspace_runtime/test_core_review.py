"""Independent legacy/admission boundary regressions using temporary SQLite."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_runtime.store import WorkspaceStateStore


@pytest.fixture
def journals(tmp_path):
    with (
        SQLiteRunJournal(tmp_path / "review.sqlite") as first,
        SQLiteRunJournal(tmp_path / "review.sqlite") as second,
    ):
        yield first, second


def bind_legacy(journal, root, *, suffix="A"):
    journal.put_git_repository(
        repository_id=f"repo-{suffix}",
        space_id=f"space-{suffix}",
        repository_role="content",
        root_path=str(root),
        root_path_digest="a" * 64,
        ownership="eigent_owned",
        state="ready",
        version_coverage="full",
    )
    return journal.ensure_project_workspace_binding(
        project_id=f"project-{suffix}",
        repository_id=f"repo-{suffix}",
        checkout_id=f"checkout-{suffix}",
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path=str(root),
    )


def enqueue(journal, request_id, *, suffix="A"):
    return journal.enqueue_workspace_writer(
        request_id=request_id,
        repository_id=f"repo-{suffix}",
        checkout_id=f"checkout-{suffix}",
        project_id=f"project-{suffix}",
        task_id=f"task-{request_id}",
        target_ref="refs/heads/main",
        reason="review",
    )


def test_never_acquired_cancelled_request_is_not_imported_as_writer(
    journals, tmp_path
):
    journal, sibling = journals
    root = tmp_path / "space"
    root.mkdir()
    bind_legacy(journal, root)
    assert enqueue(journal, "writer").status == "acquired"
    assert enqueue(sibling, "queued").status == "queued"
    sibling.interrupt_workspace_writer(
        request_id="queued", task_id="task-queued"
    )
    journal.release_workspace_writer(
        request_id="writer", task_id="task-writer"
    )
    historical = sibling.get_workspace_writer_request("queued")
    assert historical.status == "interrupted"
    assert historical.acquired_at is None
    assert WorkspaceStateStore(journal).register_target(root).available


def test_queued_cancel_cannot_steal_live_integration_owner(journals, tmp_path):
    journal, sibling = journals
    root = tmp_path / "space"
    root.mkdir()
    bind_legacy(journal, root)
    state = WorkspaceStateStore(journal)
    owner = state.acquire_target(
        state.register_target(root),
        owner_kind="integration",
        owner_id="publisher",
    )
    assert enqueue(sibling, "queued").status == "queued"
    sibling.interrupt_workspace_writer(
        request_id="queued", task_id="task-queued"
    )
    assert WorkspaceStateStore(sibling).register_target(root) == owner
    assert state.settle_target(owner, "published").available


def test_actual_interrupted_writer_remains_blocking_after_legacy_release(
    journals, tmp_path
):
    journal, sibling = journals
    root = tmp_path / "space"
    root.mkdir()
    bind_legacy(journal, root)
    assert enqueue(journal, "writer").status == "acquired"
    journal.interrupt_workspace_writer(
        request_id="writer", task_id="task-writer"
    )
    historical = sibling.get_workspace_writer_request("writer")
    assert historical.status == "interrupted"
    assert historical.acquired_at is not None
    target = WorkspaceStateStore(sibling).register_target(root)
    assert not target.available
    assert (target.owner_kind, target.owner_id) == ("legacy", "writer")


def test_registration_between_legacy_discovery_and_claim_is_serialized(
    journals, tmp_path, monkeypatch
):
    """Registration wins the race even after a writer saw no enabled target."""
    journal, sibling = journals
    root = tmp_path / "space"
    root.mkdir()
    bind_legacy(journal, root)
    discovered, resume = Event(), Event()
    original = WorkspaceStateStore.map_registered_legacy_binding

    def hold_after_discovery(store, project_id):
        original(store, project_id)
        if store.journal is sibling:
            discovered.set()
            assert resume.wait(timeout=5)

    monkeypatch.setattr(
        WorkspaceStateStore,
        "map_registered_legacy_binding",
        hold_after_discovery,
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(enqueue, sibling, "legacy")
        assert discovered.wait(timeout=5)
        state = WorkspaceStateStore(journal)
        owner = state.acquire_target(
            state.register_target(root),
            owner_kind="integration",
            owner_id="publisher",
        )
        resume.set()
        assert future.result(timeout=5).status == "queued"
    assert state.target(owner.target_id) == owner
