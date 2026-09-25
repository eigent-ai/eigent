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

"""Additive RunJournal schema; no second database or background authority."""

from .admission import ADMISSION_TABLES

MIGRATION_V36 = (
    """
BEGIN IMMEDIATE;
"""
    + ADMISSION_TABLES
    + """
CREATE TABLE IF NOT EXISTS workspace_physical_targets (
    target_id TEXT PRIMARY KEY,
    root_path TEXT NOT NULL,
    physical_identity TEXT NOT NULL UNIQUE,
    binding_version INTEGER NOT NULL DEFAULT 1,
    write_epoch INTEGER NOT NULL DEFAULT 0,
    receipt_cursor INTEGER NOT NULL DEFAULT 0,
    settled_revision TEXT,
    state TEXT NOT NULL DEFAULT 'settled'
        CHECK(state IN ('settled', 'writing', 'recovery_required')),
    owner_kind TEXT,
    owner_id TEXT,
    owner_generation INTEGER NOT NULL DEFAULT 0,
    CHECK ((owner_kind IS NULL) = (owner_id IS NULL)),
    CHECK (state != 'settled' OR owner_id IS NULL)
);
CREATE TABLE IF NOT EXISTS workspace_target_revisions (
    target_id TEXT NOT NULL REFERENCES workspace_physical_targets(target_id),
    receipt_cursor INTEGER NOT NULL,
    write_epoch INTEGER NOT NULL,
    revision TEXT NOT NULL,
    PRIMARY KEY(target_id, receipt_cursor)
);
CREATE TABLE IF NOT EXISTS workspace_legacy_targets (
    repository_id TEXT NOT NULL,
    checkout_id TEXT NOT NULL,
    target_id TEXT NOT NULL REFERENCES workspace_physical_targets(target_id),
    PRIMARY KEY(repository_id,checkout_id)
);
CREATE TABLE IF NOT EXISTS workspace_revision_references (
    revision TEXT NOT NULL,
    owner TEXT NOT NULL,
    PRIMARY KEY(revision, owner)
);
CREATE TABLE IF NOT EXISTS run_workspace_bindings (
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    generation INTEGER NOT NULL,
    attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
    workspace_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL CHECK(provider IN ('git', 'directory')),
    snapshot_revision TEXT NOT NULL,
    root_path TEXT NOT NULL,
    target_id TEXT NOT NULL REFERENCES workspace_physical_targets(target_id),
    target_binding_version INTEGER NOT NULL,
    policy_version TEXT NOT NULL,
    PRIMARY KEY(run_id, generation)
);
CREATE TABLE IF NOT EXISTS run_workspace_finalizations (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
    owner_attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
    generation INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK(state IN ('pending','settling','settled','needs_attention')),
    writer_settlement_json TEXT,
    checkpoint_revision TEXT,
    manifest_digest TEXT,
    outcome TEXT CHECK(outcome IN ('completed','failed','cancelled','interrupted')),
    receipt_json TEXT,
    FOREIGN KEY(run_id,generation)
        REFERENCES run_workspace_bindings(run_id,generation)
);
CREATE TABLE IF NOT EXISTS workspace_integration_requests (
    request_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    project_id TEXT NOT NULL,
    target_id TEXT NOT NULL REFERENCES workspace_physical_targets(target_id),
    target_binding_version INTEGER NOT NULL,
    policy_version TEXT NOT NULL,
    input_revision TEXT NOT NULL,
    output_revision TEXT NOT NULL,
    finalizer_receipt_json TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    worker_id TEXT,
    worker_generation INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    wait_reason TEXT,
    retry_after_at REAL NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    UNIQUE(run_id, output_revision, target_binding_version, policy_version)
);
CREATE TABLE IF NOT EXISTS workspace_integration_paths (
    change_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES workspace_integration_requests(request_id),
    relative_path TEXT NOT NULL,
    group_id TEXT NOT NULL,
    predecessor_change_id TEXT REFERENCES workspace_integration_paths(change_id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','integrated','equivalent','conflict',
                         'waiting','needs_rebase','resolved','discarded')),
    evidence_json TEXT,
    target_before_revision TEXT,
    target_after_revision TEXT,
    receipt_cursor INTEGER,
    operation_id TEXT,
    resolution_revision TEXT,
    UNIQUE(request_id,relative_path)
);
CREATE INDEX IF NOT EXISTS workspace_integration_pending
    ON workspace_integration_requests(status,created_at);
CREATE INDEX IF NOT EXISTS workspace_integration_path_history
    ON workspace_integration_paths(relative_path,request_id);
CREATE TABLE IF NOT EXISTS workspace_publication_operations (
    operation_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES workspace_integration_requests(request_id),
    target_id TEXT NOT NULL REFERENCES workspace_physical_targets(target_id),
    owner_generation INTEGER NOT NULL,
    worker_generation INTEGER NOT NULL,
    candidate_digest TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('prepared','dispatched','completed','aborted','needs_attention')),
    result_revision TEXT,
    created_at REAL NOT NULL
);
INSERT OR IGNORE INTO run_journal_migrations(version,applied_at)
VALUES (36, CAST(strftime('%s', 'now') AS REAL));
PRAGMA user_version = 36;
COMMIT;
"""
)

MIGRATION_V37 = """
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS workspace_publication_temporaries (
    operation_id TEXT NOT NULL REFERENCES workspace_publication_operations(operation_id),
    temporary_path TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    expected_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('reserved','created','ready','retired')),
    identity_json TEXT,
    ready_token_json TEXT,
    PRIMARY KEY(operation_id,temporary_path)
);
INSERT OR IGNORE INTO run_journal_migrations(version,applied_at)
VALUES (37, CAST(strftime('%s', 'now') AS REAL));
PRAGMA user_version = 37;
COMMIT;
"""

MIGRATION_V38 = """
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS execution_delivery_operations (
    operation_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES execution_requests(request_id),
    delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('wait','send_now')),
    target_run_id TEXT REFERENCES runs(run_id),
    target_attempt_id TEXT REFERENCES run_attempts(attempt_id),
    target_generation INTEGER CHECK(target_generation > 0),
    cancel_request_id TEXT,
    created_at REAL NOT NULL,
    CHECK ((target_run_id IS NULL) = (target_attempt_id IS NULL)),
    CHECK ((target_run_id IS NULL) = (target_generation IS NULL)),
    CHECK (target_run_id IS NOT NULL OR cancel_request_id IS NULL)
);
INSERT OR IGNORE INTO run_journal_migrations(version,applied_at)
VALUES (38, CAST(strftime('%s', 'now') AS REAL));
PRAGMA user_version = 38;
COMMIT;
"""

MIGRATION_V39 = """
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS managed_execution_configurations (
    configuration_revision TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    principal_ref TEXT NOT NULL,
    document_json TEXT NOT NULL CHECK(json_valid(document_json)),
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS managed_execution_configurations_project
    ON managed_execution_configurations(project_id, created_at);
INSERT OR IGNORE INTO run_journal_migrations(version,applied_at)
VALUES (39, CAST(strftime('%s', 'now') AS REAL));
PRAGMA user_version = 39;
COMMIT;
"""

MIGRATION_V40 = """
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS project_execution_routes (
    project_id TEXT PRIMARY KEY,
    route TEXT NOT NULL CHECK(route IN ('legacy','managed_single')),
    principal_ref TEXT,
    space_id TEXT,
    created_at REAL NOT NULL,
    CHECK(route = 'legacy' OR (principal_ref IS NOT NULL AND space_id IS NOT NULL))
);
INSERT OR IGNORE INTO run_journal_migrations(version,applied_at)
VALUES (40, CAST(strftime('%s', 'now') AS REAL));
PRAGMA user_version = 40;
COMMIT;
"""
