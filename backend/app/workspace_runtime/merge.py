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

"""Pure, deterministic three-way merge planning for immutable file versions.

This module reads no files and executes no Git commands, hooks, or drivers.
``None`` is a missing-file tombstone, not an empty file. Conflicts retain all
three inputs and never expose partially merged content or conflict markers.

Text merges use complete UTF-8 lines, preserving their original terminators.
Different insertions at the same base gap conflict: their ordering cannot be
inferred. An insertion on the boundary of a replacement/deletion is adjacent
and survives before/after that edit; an insertion strictly inside it conflicts.
Matching repeated lines uses SequenceMatcher with autojunk disabled and its
deterministic earliest-match rule. This is a textual plan, not a claim about
semantic independence or an inference of rename intent.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Literal

MERGE_ALGORITHM_VERSION = "utf8-lines-v1"

FileKind = Literal["file", "symlink"]
MergeOutcome = Literal[
    "unchanged", "source", "equivalent", "merged", "conflict"
]
ConflictReason = Literal[
    "add_add",
    "delete_modify",
    "kind_conflict",
    "mode_conflict",
    "binary_conflict",
    "text_conflict",
]


@dataclass(frozen=True)
class FileVersion:
    """Immutable file bytes plus kind and permission bits (not st_mode)."""

    kind: FileKind
    content: bytes
    mode: int = 0o644

    def __post_init__(self) -> None:
        if self.kind not in {"file", "symlink"}:
            raise ValueError("file kind must be file or symlink")
        if not isinstance(self.content, bytes):
            raise TypeError("file content must be immutable bytes")
        if type(self.mode) is not int or not 0 <= self.mode <= 0o7777:
            raise ValueError("file mode must contain permission bits only")


@dataclass(frozen=True)
class MergeConflict:
    reason: ConflictReason
    # Zero-based, half-open BASE line range; (n, n) denotes an insertion gap.
    base_range: tuple[int, int] | None = None


@dataclass(frozen=True)
class MergeResult:
    outcome: MergeOutcome
    version: FileVersion | None
    base: FileVersion | None
    source: FileVersion | None
    target: FileVersion | None
    conflicts: tuple[MergeConflict, ...] = ()
    algorithm_version: str = MERGE_ALGORITHM_VERSION

    @property
    def content(self) -> bytes | None:
        """Result bytes, or None for either a deletion or a conflict.

        Callers MUST check outcome before publishing: a conflict's None is
        deliberately not a deletion candidate.
        """

        return self.version.content if self.version is not None else None


@dataclass(frozen=True)
class MergePathGroup:
    """Caller-declared atomic path group, e.g. an explicit rename pair.

    The planner does not discover renames or dependencies. The publisher must
    withhold the whole group if any member conflicts. Groups must not overlap
    within a publication plan; the plan owner must check that constraint.
    """

    group_id: str
    paths: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.group_id.strip():
            raise ValueError("path group identity is required")
        if not isinstance(self.paths, tuple) or not self.paths:
            raise ValueError("path group must contain an immutable path tuple")
        if len(set(self.paths)) != len(self.paths):
            raise ValueError("path group contains duplicate paths")
        for path in self.paths:
            if (
                not isinstance(path, str)
                or not path
                or "\\" in path
                or "\x00" in path
                or any(part in {"", ".", ".."} for part in path.split("/"))
            ):
                raise ValueError(
                    "group paths must be normalized relative paths"
                )


def merge_file(
    base: FileVersion | None,
    source: FileVersion | None,
    target: FileVersion | None,
) -> MergeResult:
    """Plan a source delta against target without performing publication.

    Equality rules apply to entire versions, before text/binary classification.
    ``unchanged`` means source made no change; return target as-is. ``source``
    means only source changed. ``equivalent`` means both sides already agree.
    Independent content and mode changes of regular files can combine, but
    incompatible kind/mode changes or concurrent symlink changes conflict.
    """

    def result(
        outcome: MergeOutcome,
        version: FileVersion | None,
        conflicts: tuple[MergeConflict, ...] = (),
    ) -> MergeResult:
        return MergeResult(outcome, version, base, source, target, conflicts)

    def conflict(reason: ConflictReason) -> MergeResult:
        return result("conflict", None, (MergeConflict(reason),))

    if source == base:
        return result("unchanged", target)
    if source == target:
        return result("equivalent", target)
    if target == base:
        return result("source", source)
    if base is None:
        return conflict("add_add")
    if source is None or target is None:
        return conflict("delete_modify")
    if not (base.kind == source.kind == target.kind == "file"):
        return conflict("kind_conflict")

    if source.mode == base.mode:
        merged_mode = target.mode
    elif target.mode == base.mode or source.mode == target.mode:
        merged_mode = source.mode
    else:
        return conflict("mode_conflict")

    if source.content == base.content:
        content = target.content
    elif target.content == base.content or source.content == target.content:
        content = source.content
    else:
        texts = tuple(
            _text_lines(item.content) for item in (base, source, target)
        )
        if any(lines is None for lines in texts):
            return conflict("binary_conflict")
        base_lines, source_lines, target_lines = texts
        assert base_lines is not None
        assert source_lines is not None
        assert target_lines is not None
        content, conflicts = _merge_lines(
            base_lines, source_lines, target_lines
        )
        if conflicts:
            return result("conflict", None, conflicts)
        assert content is not None

    return result("merged", FileVersion("file", content, merged_mode))


def _text_lines(content: bytes) -> tuple[str, ...] | None:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if any(
        (ord(char) < 32 and char not in "\t\r\n") or ord(char) == 127
        for char in text
    ):
        return None
    return tuple(text.splitlines(keepends=True))


@dataclass(frozen=True)
class _Edit:
    start: int
    end: int
    replacement: tuple[str, ...]
    side: int


def _edits(
    base: tuple[str, ...], changed: tuple[str, ...], side: int
) -> list[_Edit]:
    edits: list[_Edit] = []
    matcher = SequenceMatcher(None, base, changed, autojunk=False)
    for tag, start, end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        # Splitting aligned replacements lets a shared change deduplicate
        # while an adjacent extra change on either side still survives.
        if tag == "replace" and end - start == new_end - new_start:
            for offset in range(end - start):
                edits.append(
                    _Edit(
                        start + offset,
                        start + offset + 1,
                        (changed[new_start + offset],),
                        side,
                    )
                )
        else:
            edits.append(_Edit(start, end, changed[new_start:new_end], side))
    return edits


def _overlaps(left: _Edit, right: _Edit) -> bool:
    if left.start == left.end:
        if right.start == right.end:
            return left.start == right.start
        return right.start < left.start < right.end
    if right.start == right.end:
        return left.start < right.start < left.end
    return max(left.start, right.start) < min(left.end, right.end)


def _render_region(
    base: tuple[str, ...], start: int, end: int, edits: list[_Edit]
) -> tuple[str, ...]:
    rendered: list[str] = []
    cursor = start
    for edit in sorted(edits, key=lambda item: (item.start, item.end)):
        rendered.extend(base[cursor : edit.start])
        rendered.extend(edit.replacement)
        cursor = edit.end
    rendered.extend(base[cursor:end])
    return tuple(rendered)


def _merge_lines(
    base: tuple[str, ...], source: tuple[str, ...], target: tuple[str, ...]
) -> tuple[bytes | None, tuple[MergeConflict, ...]]:
    edits = sorted(
        _edits(base, source, 0) + _edits(base, target, 1),
        key=lambda edit: (edit.start, edit.end, edit.side),
    )
    parents = list(range(len(edits)))

    def root(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    # Connected components of overlapping edits. The sweep excludes adjacent
    # edits and avoids a quadratic comparison of unrelated source/target hunks.
    active: list[int] = []
    for index, edit in enumerate(edits):
        active = [
            other
            for other in active
            if edits[other].end > edit.start
            or edits[other].start == edits[other].end == edit.start
        ]
        for other in active:
            if edits[other].side != edit.side and _overlaps(
                edits[other], edit
            ):
                parents[root(index)] = root(other)
        active.append(index)

    components: dict[int, list[_Edit]] = defaultdict(list)
    for index, edit in enumerate(edits):
        components[root(index)].append(edit)

    merged_edits: list[_Edit] = []
    conflicts: list[MergeConflict] = []
    for group in components.values():
        start = min(edit.start for edit in group)
        end = max(edit.end for edit in group)
        left = [edit for edit in group if edit.side == 0]
        right = [edit for edit in group if edit.side == 1]
        if not left or not right:
            merged_edits.extend(group)
            continue
        source_region = _render_region(base, start, end, left)
        target_region = _render_region(base, start, end, right)
        if source_region == target_region:
            merged_edits.append(_Edit(start, end, source_region, 0))
        elif all(not edit.replacement for edit in group):
            # Overlapping deletions agree about every shared deleted line.
            merged_edits.append(_Edit(start, end, (), 0))
        else:
            conflicts.append(MergeConflict("text_conflict", (start, end)))
    if conflicts:
        return None, tuple(
            sorted(conflicts, key=lambda item: item.base_range or (0, 0))
        )
    merged = _render_region(base, 0, len(base), merged_edits)
    return "".join(merged).encode("utf-8"), ()
