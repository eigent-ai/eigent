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

"""Pure, reconstructible policy for a materialized Memory entry.

Mutation-time authorization (for example, proving that an Agent Space write
has a durable HumanInteraction decision) remains in ``LightweightMemoryService``.
This module contains the entry invariants that can and must be revalidated when
a Cloud read model is merged back into a Desktop journal.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.workspace_config.models import (
    assert_cloud_projection_safe,
    assert_manifest_secret_free,
)

EXTERNAL_MEMORY_TRUST = frozenset(
    {"external_untrusted", "tool_observed", "model_inferred"}
)
INSTRUCTION_MEMORY_KINDS = frozenset({"preference", "constraint"})


def normalize_memory_provenance_for_cloud(
    *, kind: str, source_trust: str, deleted: bool
) -> tuple[str, str]:
    """Project legacy local rows into a Cloud-safe, non-authoritative shape.

    Older clients could persist model/tool/external observations as an
    instruction kind.  New writes must reject that shape, but anti-entropy
    cannot permanently wedge on data the product itself previously produced.
    Downgrading the kind to ``fact`` preserves recall without granting the
    historical text instruction authority.
    """

    if not deleted and source_trust in EXTERNAL_MEMORY_TRUST:
        if kind in INSTRUCTION_MEMORY_KINDS:
            return "fact", source_trust
    return kind, source_trust


def assert_memory_entry_policy(
    *,
    kind: str,
    content: str,
    created_by: str,
    source_trust: str,
    confirmed_by_user: bool,
    source_refs: Sequence[str] = (),
    deleted: bool = False,
    cloud_projection: bool = False,
) -> None:
    """Enforce content and provenance invariants independent of the writer.

    ``cloud_projection`` additionally rejects identifying device-home paths.
    Local Memory may mention local paths, but its Cloud projection must redact
    them before upload and a Cloud baseline must never restore them.
    """

    if deleted:
        if content:
            raise PermissionError("Deleted Memory must not retain plaintext")
        # A tombstone has no model-visible semantics.  Legacy provenance is
        # retained for audit but cannot prevent the user from deleting it.
        return

    projection = {"content": content, "source_refs": list(source_refs)}
    assert_manifest_secret_free(projection)
    if cloud_projection:
        assert_cloud_projection_safe(projection)

    if (
        source_trust in EXTERNAL_MEMORY_TRUST
        and kind in INSTRUCTION_MEMORY_KINDS
    ):
        raise PermissionError(
            "Untrusted or inferred content cannot become a preference or "
            "constraint without user-authored adoption"
        )
    if source_trust == "user_confirmed" and not (
        created_by == "user" and confirmed_by_user
    ):
        raise PermissionError(
            "Only confirmed user-authored Memory may claim user_confirmed"
        )
    if created_by == "user" and not (
        source_trust == "user_confirmed" and confirmed_by_user
    ):
        raise PermissionError(
            "User-authored Memory must use confirmed user trust"
        )
