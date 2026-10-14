# PR #1965 review: `resolved_model` on Run reads

Open findings from the review of
[eigent-ai/eigent#1965](https://github.com/eigent-ai/eigent/pull/1965)
("feat: expose resolved model identity per Run"), commit `a5277ef2f`.
Remove this file once every item below is fixed or explicitly declined.

Scope: `_resolved_model_for_attempt` and its two callers in
`backend/app/controller/run_controller.py`, plus
`test_run_reads_expose_bound_model_without_auth_details` in
`backend/tests/app/controller/test_run_control_api.py`.

## Bugs

### 1. Only the latest Attempt is checked for a model binding

- **Where:** `run_controller.py`, `_resolved_model_for_attempt`
  (`if attempt is None or not attempt.environment_spec_id: return None`), called
  with `attempts[-1]` from `list_project_runs` and `get_run`.
- **Problem:** When the latest Attempt carries no `environment_spec_id`, the
  helper returns `None` instead of walking back to the most recent bound
  Attempt.
- **When it happens:**
  - `SQLiteRunJournal.fork_run` inserts a `fork_checkpoint` Attempt without any
    environment columns, so every freshly forked Run reports
    `resolved_model: null`.
  - `chat_controller.py` can create an Attempt with
    `environment=(environment.binding if environment else None)`.
- **Why it's inconsistent:** `RunCoordinator._latest_environment_binding`
  (`backend/app/run_runtime/coordinator.py`) already walks attempts in reverse
  and skips unbound ones. A resumed Run executes on that earlier binding, but
  the read API says it has no model.
- **Fix direction:** Resolve from the most recent Attempt that has an
  `environment_spec_id`, sharing the coordinator's walk instead of
  re-implementing it.

### 2. Owner check rejects Attempt-owned EnvironmentSpecs

- **Where:** `run_controller.py`,
  `if spec is None or spec.owner_id != attempt.run_id: return None`.
- **Problem:** The schema allows `owner_type IN ('run', 'run_attempt')`, and the
  journal validates ownership as
  `run_id if spec["owner_type"] == "run" else attempt_id`
  (`backend/app/run_journal/store.py`, attempt creation paths). The new guard
  only accepts Run-owned specs.
- **When it happens:** Not reachable today, because admission only writes
  `owner_type="run"`. Once a per-Attempt spec is admitted, its model silently
  disappears from Run reads.
- **Fix direction:** Mirror the store's rule:
  `expected = attempt.run_id if spec.owner_type == "run" else attempt.attempt_id`.

## Cleanup

### 3. Fourth copy of the manifest model lookup

- **Where:** `run_controller.py`, the
  `semantic_spec -> runtime_capability_manifest -> model` walk.
- **Existing copies:** `chat_controller.py` (`_validate_resume_model_capability`,
  `persisted_model = spec.semantic_spec.get("runtime_capability_manifest", {})
  .get("model", {})`) and `backend/app/workspace_config/model_selection.py`
  (Session model ownership check).
- **Extra drift risk:** This copy reads `redacted_spec` (the Cloud projection),
  while the others read the local spec. A change to `cloud_projection()` could
  break Run reads without affecting resume validation.
- **Fix direction:** Add one accessor on the EffectiveEnvironmentSpec record
  (for example `bound_model() -> {"platform", "type"} | None`) and use it in
  all four places.

### 4. One more per-Run thread hop and query in the Run list

- **Where:** `list_project_runs`. Each Run now does an extra
  `asyncio.to_thread(_resolved_model_for_attempt, ...)` plus a
  `get_effective_environment_spec` SQLite lookup, run one after another inside
  the loop.
- **Cost:** At `limit=100` this adds about 100 sequential thread dispatches and
  journal lock acquisitions to the first Project open, which the comment at the
  top of the function is trying to keep fast.
- **Fix direction:** Batch-load the specs by id (as `list_attempt_user_waits`
  does for waits), or compute the model inside the same thread call that lists
  the attempts.

## Test coverage

### 5. Only the happy path is tested

- **Where:** `test_run_reads_expose_bound_model_without_auth_details`.
- **Missing cases:**
  - forked Run, or a latest Attempt without an environment (bug 1)
  - Attempt-owned spec, or a spec owned by another Run (bug 2)
  - manifest without `model`, or with an empty `platform` or `type`
- **Redundant assertion:** The final
  `assert set(listing["runs"][0]["resolved_model"]) == {"platform", "type"}`
  repeats the equality check above it. Replace it with an explicit check that
  `auth_source` is absent if that is the intent.
