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

"""Real temporary journal/CAS input composition; never mutate the target tree."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_runtime.content import (
    ContentIntegrityError,
    ContentStore,
    ManifestEntry,
    WorkspaceManifest,
    canonical_json,
)
from app.workspace_runtime.provider import (
    DirectoryWorkspaceProvider,
    SnapshotRef,
    SourceFence,
)
from app.workspace_runtime.session_input import (
    SessionInputConflict,
    compose_session_input,
)
from app.workspace_runtime.store import (
    WorkspaceFenceLost,
    WorkspaceStateError,
    WorkspaceStateStore,
)


class Fixture:
    def __init__(self, tmp_path, journal):
        self.journal = journal
        self.state = WorkspaceStateStore(journal)
        self.root = tmp_path / "target"
        self.root.mkdir()
        self.target = self.state.register_target(self.root)
        self.content = ContentStore(tmp_path / "cas")
        self.provider = DirectoryWorkspaceProvider(
            self.content, tmp_path / "private", retention=self.state
        )

    def manifest(self, paths, *, coverage=(), receipts=()):
        entries = []
        for path, value in sorted(paths.items()):
            if value is None:
                entries.append(ManifestEntry(path, "directory", mode=0o755))
            else:
                data, mode = (
                    value if isinstance(value, tuple) else (value, 0o644)
                )
                entries.append(
                    ManifestEntry(
                        path,
                        "file",
                        self.content.put_blob(data),
                        len(data),
                        mode,
                    )
                )
        return self.content.put_manifest(
            WorkspaceManifest(
                entries=tuple(entries),
                coverage=coverage,
                mutation_receipts=receipts,
            )
        )

    def pin(self, revision, *, owner="next"):
        self.target = self.state.record_observed_revision(
            self.target, revision
        )
        target = self.target
        return SnapshotRef(
            revision,
            owner,
            SourceFence(
                target.target_id,
                target.physical_identity,
                target.write_epoch,
                target.settled_revision,
                target.receipt_cursor,
                target.state,
                target.owner_id,
                target.binding_version,
            ),
        )

    def compose(self, snapshot, project="project"):
        result = compose_session_input(
            self.state, self.provider, project, self.target, snapshot
        )
        # Source projection is immutable; shared target stays untouched.
        assert tuple(self.root.iterdir()) == ()
        return result

    def complete(self, run, before, after, *, project="project"):
        self.journal.ensure_run(
            run_id=run, project_id=project, status="pending"
        )
        with self.journal._write_transaction() as connection:
            attempt = self.journal._create_run_attempt_in_transaction(
                connection, run, request_id=run, reason="test", activate=False
            )
            self.state.bind_run_in_transaction(
                connection,
                run_id=run,
                attempt_id=attempt.attempt_id,
                generation=1,
                workspace_id="private-" + run,
                provider="directory",
                snapshot_revision=before,
                root_path=str(self.root.parent / ("private-" + run)),
                target=self.target,
                policy_version="isolated-v1",
            )
        self.state.record_writer_settlement(
            run_id=run,
            attempt_id=attempt.attempt_id,
            generation=1,
            process_receipt={
                "outcome": "stopped",
                "fixture": "no actual writer",
            },
        )
        first = {
            e.path: e
            for e in self.content.get_manifest(before).entries
            if e.kind != "tombstone"
        }
        second = {
            e.path: e
            for e in self.content.get_manifest(after).entries
            if e.kind != "tombstone"
        }
        changes = {
            p: "group-" + run
            for p in first.keys() | second.keys()
            if first.get(p) != second.get(p)
        }
        with self.journal._write_transaction() as connection:
            self.journal._append_event_in_transaction(
                connection,
                run,
                RunEventDraft(
                    event_id="terminal-" + run,
                    event_type="run.completed",
                    payload={},
                ),
                run_status="completed",
                clear_active_attempt=True,
            )
            request = self.state.finalize_in_transaction(
                connection,
                run_id=run,
                attempt_id=attempt.attempt_id,
                generation=1,
                checkpoint_revision=after,
                manifest_digest=self.content.put_blob(
                    b"artifact:" + run.encode()
                ),
                outcome="completed",
                changed_paths=changes,
            )
        return request

    def paths(self, revision):
        return {
            e.path: None
            if e.kind == "directory"
            else self.content.read_blob(e.digest)
            for e in self.content.get_manifest(revision).entries
            if e.kind != "tombstone"
        }


@pytest.fixture
def fixture(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        yield Fixture(tmp_path, journal)


def test_unpublished_r1_is_visible_to_r2_without_new_mutation_authority(
    fixture,
):
    before = fixture.manifest({"f": b"base\n"})
    after = fixture.manifest({"f": b"private\n"}, receipts=("old-tool",))
    snapshot = fixture.pin(before)
    fixture.complete("r1", before, after)
    result = fixture.compose(snapshot)
    assert fixture.paths(result.revision_id) == {"f": b"private\n"}
    manifest = fixture.content.get_manifest(result.revision_id)
    assert manifest.mutation_receipts == ()
    assert {before, after} <= set(manifest.lineage)
    assert manifest.parent_revision == snapshot.revision_id
    assert fixture.state.references(result.revision_id) == (
        "preparation:next",
    )
    assert fixture.paths(before) == {"f": b"base\n"}


def test_each_run_original_delta_preserves_new_target_lines(fixture):
    original = fixture.manifest({"f": b"a0\nb0\nc0\n"})
    first = fixture.manifest({"f": b"a1\nb0\nc0\n"})
    fixture.pin(original)
    fixture.complete("r1", original, first)
    parallel = fixture.manifest({"f": b"a0\nb1\nc0\n"})
    second_input = fixture.compose(fixture.pin(parallel)).revision_id
    assert fixture.paths(second_input)["f"] == b"a1\nb1\nc0\n"
    second = fixture.manifest({"f": b"a1\nb1\nc2\n"})
    fixture.complete("r2", second_input, second)
    latest = fixture.manifest({"f": b"a0\nb2\nc0\n"})
    composed = fixture.compose(fixture.pin(latest))
    assert fixture.paths(composed.revision_id)["f"] == b"a1\nb2\nc2\n"


def test_simple_sequential_same_path_changes_do_not_conflict(fixture):
    first = fixture.manifest({"same": b"zero"})
    second = fixture.manifest({"same": b"one"})
    third = fixture.manifest({"same": b"two"})
    snapshot = fixture.pin(first)
    fixture.complete("r1", first, second)
    fixture.complete("r2", second, third)
    assert fixture.paths(fixture.compose(snapshot).revision_id) == {
        "same": b"two"
    }


def test_true_input_conflict_waits_and_other_project_is_independent(fixture):
    base = fixture.manifest({"f": b"base\n"})
    source = fixture.manifest({"f": b"private\n"})
    target = fixture.manifest({"f": b"external\n"})
    snapshot = fixture.pin(target)
    fixture.complete("r1", base, source)
    with pytest.raises(SessionInputConflict, match="content_conflict"):
        fixture.compose(snapshot)
    assert fixture.compose(snapshot, project="other").revision_id == target
    assert fixture.paths(source)["f"] == b"private\n"
    assert fixture.paths(target)["f"] == b"external\n"


@pytest.mark.parametrize("replacement", [{}, {"d": b"replacement"}])
def test_directory_removal_never_drops_target_only_child(fixture, replacement):
    base = fixture.manifest({"d": None, "d/a": b"owned"})
    source = fixture.manifest(replacement)
    target = fixture.manifest(
        {"d": None, "d/a": b"owned", "d/new": b"external"}
    )
    snapshot = fixture.pin(target)
    fixture.complete("r1", base, source)
    with pytest.raises(SessionInputConflict, match="directory_dependency"):
        fixture.compose(snapshot)
    assert fixture.paths(target)["d/new"] == b"external"


def test_complete_directory_delete_is_planned_once_for_the_whole_run(fixture):
    base = fixture.manifest(
        {"d": None, "d/a": b"a", "d/sub": None, "d/sub/b": b"b"}
    )
    source = fixture.manifest({})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    assert fixture.paths(fixture.compose(snapshot).revision_id) == {}


def test_explicit_file_to_directory_delta_builds_a_coherent_input(fixture):
    base = fixture.manifest({"d": b"file"})
    source = fixture.manifest({"d": None, "d/x": b"child"})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    assert fixture.paths(fixture.compose(snapshot).revision_id) == {
        "d": None,
        "d/x": b"child",
    }


@pytest.mark.parametrize("target_paths", [{}, {"d": b"target file"}])
def test_new_child_does_not_resurrect_or_replace_target_parent(
    fixture, target_paths
):
    base = fixture.manifest({"d": None})
    source = fixture.manifest({"d": None, "d/x": b"new child"})
    snapshot = fixture.pin(fixture.manifest(target_paths))
    fixture.complete("r1", base, source)
    with pytest.raises(SessionInputConflict, match="parent_path_conflict"):
        fixture.compose(snapshot)


@pytest.mark.parametrize("side", ["base", "source", "target"])
def test_coverage_unknown_descendants_block_directory_delete(fixture, side):
    coverage = ("d/hidden",)
    base = fixture.manifest(
        {"d": None, "d/a": b"known"},
        coverage=coverage if side == "base" else (),
    )
    source = fixture.manifest(
        {}, coverage=coverage if side == "source" else ()
    )
    target = fixture.manifest(
        {"d": None, "d/a": b"known"},
        coverage=coverage if side == "target" else (),
    )
    snapshot = fixture.pin(target)
    fixture.complete("r1", base, source)
    with pytest.raises(SessionInputConflict, match="directory_dependency"):
        fixture.compose(snapshot)


def test_coverage_excluded_parent_is_not_treated_as_missing(fixture):
    base = fixture.manifest({})
    source = fixture.manifest({"Private": None, "Private/f": b"new"})
    snapshot = fixture.pin(fixture.manifest({}, coverage=("private",)))
    fixture.complete("r1", base, source)
    with pytest.raises(SessionInputConflict, match="path_not_covered"):
        fixture.compose(snapshot)


@pytest.mark.parametrize(
    "column,value",
    [("status", "discarded"), ("resolution_revision", "changed-resolution")],
)
def test_receipt_race_rejects_candidate_before_retention(
    fixture, monkeypatch, column, value
):
    base = fixture.manifest({"f": b"base"})
    source = fixture.manifest({"f": b"private"})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    original = fixture.content.put_manifest
    candidates = []

    def race(manifest):
        revision = original(manifest)
        candidates.append(revision)
        fixture.journal._connection.execute(
            f"UPDATE workspace_integration_paths SET {column}=?", (value,)
        )
        return revision

    monkeypatch.setattr(fixture.content, "put_manifest", race)
    with pytest.raises(WorkspaceFenceLost, match="receipts changed"):
        fixture.compose(snapshot)
    assert candidates and fixture.state.references(candidates[-1]) == ()


def test_target_epoch_race_rejects_candidate_before_retention(
    fixture, monkeypatch
):
    base = fixture.manifest({"f": b"base"})
    source = fixture.manifest({"f": b"private"})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    original = fixture.content.put_manifest

    def race(manifest):
        revision = original(manifest)
        fixture.journal._connection.execute(
            "UPDATE workspace_physical_targets SET write_epoch=write_epoch+1"
        )
        return revision

    monkeypatch.setattr(fixture.content, "put_manifest", race)
    with pytest.raises(WorkspaceFenceLost):
        fixture.compose(snapshot)


def test_integrated_receipt_skips_old_delta_without_overwriting_later_target(
    fixture,
):
    base = fixture.manifest({"f": b"base"})
    source = fixture.manifest({"f": b"own"})
    fixture.pin(base)
    request = fixture.complete("r1", base, source)
    fixture.pin(source)
    fixture.journal._connection.execute(
        """UPDATE workspace_integration_paths SET status='integrated',
        receipt_cursor=?,target_after_revision=? WHERE request_id=?""",
        (fixture.target.receipt_cursor, source, request),
    )
    latest = fixture.manifest({"f": b"later Session"})
    assert (
        fixture.paths(fixture.compose(fixture.pin(latest)).revision_id)["f"]
        == b"later Session"
    )


def test_receipt_from_newer_target_cannot_be_paired_with_old_input(fixture):
    base = fixture.manifest({"f": b"base"})
    source = fixture.manifest({"f": b"own"})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    fixture.journal._connection.execute(
        """UPDATE workspace_integration_paths SET status='equivalent',
        receipt_cursor=?,target_after_revision=?""",
        (fixture.target.receipt_cursor + 1, source),
    )
    with pytest.raises(WorkspaceFenceLost, match="target lineage"):
        fixture.compose(snapshot)


def test_discarded_predecessor_is_not_silently_reintroduced(fixture):
    base = fixture.manifest({"f": b"base"})
    first = fixture.manifest({"f": b"first"})
    second = fixture.manifest({"f": b"second"})
    snapshot = fixture.pin(base)
    request = fixture.complete("r1", base, first)
    fixture.complete("r2", first, second)
    fixture.journal._connection.execute(
        "UPDATE workspace_integration_paths SET status='discarded' WHERE request_id=?",
        (request,),
    )
    with pytest.raises(SessionInputConflict, match="needs_rebase"):
        fixture.compose(snapshot)


@pytest.mark.parametrize(
    "column,value", [("state", "needs_attention"), ("outcome", "cancelled")]
)
def test_only_successful_settled_outputs_enter_session_input(
    fixture, column, value
):
    base = fixture.manifest({"f": b"base"})
    source = fixture.manifest({"f": b"private"})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    fixture.journal._connection.execute(
        f"UPDATE run_workspace_finalizations SET {column}=?", (value,)
    )
    assert fixture.compose(snapshot).revision_id == base


def test_missing_path_receipt_fails_closed(fixture):
    base = fixture.manifest({"a": b"base", "b": b"base"})
    source = fixture.manifest({"a": b"new", "b": b"new"})
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, source)
    fixture.journal._connection.execute(
        "DELETE FROM workspace_integration_paths WHERE relative_path='b'"
    )
    with pytest.raises(WorkspaceStateError, match="complete path receipts"):
        fixture.compose(snapshot)


def test_equality_fast_path_still_checks_chosen_object_size(fixture):
    base = fixture.manifest({"f": b"base"})
    source = fixture.manifest({"f": b"new"})
    manifest = fixture.content.get_manifest(source)
    # Inject a malformed retained manifest directly into this temporary CAS,
    # bypassing put_manifest's ingestion validation to exercise the read edge.
    bad_source = fixture.content._put(
        "manifests",
        canonical_json(
            replace(
                manifest, entries=(replace(manifest.entries[0], size=999),)
            ).to_dict()
        ),
    )
    snapshot = fixture.pin(base)
    fixture.complete("r1", base, bad_source)
    with pytest.raises(ContentIntegrityError, match="size mismatch"):
        fixture.compose(snapshot)


def test_retained_target_receipts_do_not_become_new_input_authority(fixture):
    target = fixture.manifest({"f": b"content"}, receipts=("historical-tool",))
    result = fixture.compose(fixture.pin(target))
    assert (
        fixture.content.get_manifest(result.revision_id).mutation_receipts
        == ()
    )
    assert fixture.paths(result.revision_id) == {"f": b"content"}


def test_casefold_path_collision_waits_without_hiding_target_content(fixture):
    base = fixture.manifest({})
    source = fixture.manifest({"file": b"private"})
    target = fixture.manifest({"FILE": b"target"})
    snapshot = fixture.pin(target)
    fixture.complete("r1", base, source)
    with pytest.raises(SessionInputConflict, match="ambiguous_path_tree"):
        fixture.compose(snapshot)
    assert fixture.paths(target) == {"FILE": b"target"}
