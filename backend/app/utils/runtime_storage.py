"""Code-owned, Run-scoped operational storage; never a workspace symlink.

The terminal permission gate still authorizes each command. These directories
are storage destinations, not a grant to execute arbitrary external writes.
Intermediates survive toolkit cleanup and are never uploaded as deliverables.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.run_context import RunContext
from app.utils.workspace_paths import runtime_task_root


@dataclass(frozen=True)
class RuntimeStorage:
    root: Path

    @property
    def runtime(self) -> Path:
        return self.root / "toolchains"

    @property
    def cache(self) -> Path:
        return self.root / "cache"

    @property
    def intermediates(self) -> Path:
        return self.root / "intermediates"

    def environment(self) -> dict[str, str]:
        return {
            "EIGENT_RUNTIME_DIR": str(self.runtime),
            "EIGENT_CACHE_DIR": str(self.cache),
            "EIGENT_INTERMEDIATE_DIR": str(self.intermediates),
            "XDG_CACHE_HOME": str(self.cache),
            "PIP_CACHE_DIR": str(self.cache / "pip"),
            "UV_CACHE_DIR": str(self.cache / "uv"),
            "HF_HOME": str(self.cache / "huggingface"),
        }


def runtime_storage(
    context: RunContext, *, create: bool = False
) -> RuntimeStorage:
    # Existing runtime_task_root is the task metadata boundary. Validate the
    # raw identifiers before joining: sanitization must not alias ../ or peers.
    for value in (context.project_id, context.run_id):
        if (
            not value
            or value in {".", ".."}
            or any(c in value for c in "/\\\0")
        ):
            raise ValueError("invalid runtime storage owner")
    root = runtime_task_root(
        context.email, context.project_id, context.run_id, context.user_id
    ).absolute()
    authority = Path.home().resolve()
    if not root.is_relative_to(authority):
        raise ValueError(
            "runtime storage is outside the application owner root"
        )
    for parent in (root, *root.parents):
        if parent == authority:
            break
        if parent.is_symlink():
            raise ValueError("runtime storage may not traverse a symlink")
    for workspace in (context.working_directory, context.task_output_root):
        resolved = workspace.resolve()
        if root.is_relative_to(resolved) or resolved.is_relative_to(root):
            raise ValueError(
                "runtime storage must be separate from workspace and output roots"
            )
    storage = RuntimeStorage(root)
    for target in {Path(value) for value in storage.environment().values()}:
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ValueError(
                "runtime storage child may not redirect to another root"
            )
        if create:
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
    return storage
