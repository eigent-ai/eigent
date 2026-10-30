"""Provider-neutral merge contract tests; no filesystem or Git is involved."""

from dataclasses import FrozenInstanceError
from itertools import combinations, product

import pytest

from app.workspace_runtime.merge import (
    MERGE_ALGORITHM_VERSION,
    FileVersion,
    MergePathGroup,
    merge_file,
)


def file(content: str | bytes, *, mode: int = 0o644) -> FileVersion:
    return FileVersion(
        "file",
        content.encode("utf-8") if isinstance(content, str) else content,
        mode,
    )


def assert_merged(base: str, source: str, target: str, expected: str) -> None:
    # Combining the two sides must not depend on which Session finishes first.
    for left, right in ((source, target), (target, source)):
        result = merge_file(file(base), file(left), file(right))
        assert result.outcome != "conflict", result.conflicts
        assert result.version == file(expected)
        assert result.conflicts == ()
        assert result.algorithm_version == MERGE_ALGORITHM_VERSION


def test_equality_rules_cover_missing_text_binary_kind_and_mode() -> None:
    versions = (
        None,
        file(""),
        file("text\n"),
        file(b"\x00\xff"),
        file("text\n", mode=0o755),
        FileVersion("symlink", b"target", 0o777),
    )
    for base, changed in product(versions, repeat=2):
        unchanged = merge_file(base, base, changed)
        assert unchanged.outcome == "unchanged"
        assert unchanged.version == changed
        if base == changed:
            continue
        only_source = merge_file(base, changed, base)
        assert only_source.outcome == "source"
        assert only_source.version == changed
        same_change = merge_file(base, changed, changed)
        assert same_change.outcome == "equivalent"
        assert same_change.version == changed


@pytest.mark.parametrize(
    ("base", "source", "target", "expected"),
    [
        ("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n", "A\nb\nC\n"),
        ("a\nb\n", "A\nb\n", "a\nB\n", "A\nB\n"),
        ("a\nb\nc\n", "A\nB\nc\n", "A\nb\nC\n", "A\nB\nC\n"),
        ("a\nb\nc\nd\n", "a\nd\n", "a\nb\n", "a\n"),
        ("a\nb\nc\n", "a\nc\n", "a\nb\nC\n", "a\nC\n"),
        ("a\nb\n", "new\na\nb\n", "a\nb\nlast\n", "new\na\nb\nlast\n"),
        ("a\nb\n", "a\nx\nb\n", "A\nb\n", "A\nx\nb\n"),
        ("a\nb\n", "a\nx\nb\n", "a\nB\n", "a\nx\nB\n"),
        ("a\nb\nc\n", "a\nx\nb\nc\n", "a\nc\n", "a\nx\nc\n"),
        ("a\nb\nc\n", "a\nb\nx\nc\n", "a\nc\n", "a\nx\nc\n"),
        ("a\nb\nc", "A\nb\nc", "a\nb\nC", "A\nb\nC"),
        ("a\nb\n", "A\nb\n", "a\nb", "A\nb"),
        ("a\r\nb\r\n", "A\r\nb\r\n", "a\r\nB\r\n", "A\r\nB\r\n"),
        ("猫\n犬\n鳥", "ねこ\n犬\n鳥", "猫\nいぬ\n鳥", "ねこ\nいぬ\n鳥"),
        ("a\nb\n", "x\na\nb\n", "x\na\nB\n", "x\na\nB\n"),
    ],
)
def test_text_merge_vectors(base, source, target, expected) -> None:
    assert_merged(base, source, target, expected)


def test_disjoint_and_shared_replacements_all_combinations() -> None:
    base_lines = [f"line-{index}\n" for index in range(6)]
    edits = [
        set(combo)
        for size in range(4)
        for combo in combinations(range(6), size)
    ]
    for source_indices, target_indices in product(edits, repeat=2):

        def change(indices):
            return "".join(
                f"CHANGED-{index}\n" if index in indices else original
                for index, original in enumerate(base_lines)
            )

        assert_merged(
            "".join(base_lines),
            change(source_indices),
            change(target_indices),
            change(source_indices | target_indices),
        )


@pytest.mark.parametrize(
    ("base", "source", "target"),
    [
        ("a\nb\nc\n", "a\nB\nc\n", "a\nOTHER\nc\n"),
        ("a\nb\n", "a\nx\nb\n", "a\ny\nb\n"),
        ("a\nb\n", "first\na\nb\n", "other\na\nb\n"),
        ("a\nb\n", "a\nb\nlast\n", "a\nb\nother\n"),
        ("a\nb\nc\nd\n", "a\nd\n", "a\nb\nx\nc\nd\n"),
        ("a\nb\nc\n", "a\nc\n", "a\nB\nc\n"),
        ("a\nb", "a\nB", "a\nb\nnew"),
        ("", "first", "second"),
    ],
)
def test_true_text_conflicts_preserve_versions_without_publish_content(
    base, source, target
) -> None:
    for left, right in ((source, target), (target, source)):
        versions = (file(base), file(left), file(right))
        result = merge_file(*versions)
        assert result.outcome == "conflict"
        assert result.version is None
        assert result.content is None
        assert (result.base, result.source, result.target) == versions
        assert {conflict.reason for conflict in result.conflicts} == {
            "text_conflict"
        }


def test_multiple_conflicts_have_stable_base_ranges() -> None:
    result = merge_file(
        file("a\nb\nc\n"), file("A\nb\nC\n"), file("X\nb\nZ\n")
    )
    assert [conflict.base_range for conflict in result.conflicts] == [
        (0, 1),
        (2, 3),
    ]
    assert result.content is None


def test_repeated_lines_do_not_trigger_popular_line_heuristic() -> None:
    base = (
        "anchor\n" + "repeat\n" * 250 + "middle\n" + "repeat\n" * 250 + "end"
    )
    source = base.replace("anchor\n", "changed-anchor\n", 1)
    target = base.removesuffix("end") + "changed-end"
    expected = source.removesuffix("end") + "changed-end"
    assert_merged(base, source, target, expected)
    assert_merged(
        "a\na\nb\na\na\n",
        "A\na\nb\na\na\n",
        "a\na\nb\na\nA\n",
        "A\na\nb\na\nA\n",
    )


def test_repeated_line_triples_have_symmetric_plans() -> None:
    versions = [
        file("".join(words))
        for size in range(4)
        for words in product(("a\n", "b\n"), repeat=size)
    ]
    for base, source, target in product(versions, repeat=3):
        forward = merge_file(base, source, target)
        reverse = merge_file(base, target, source)
        assert forward.version == reverse.version
        assert forward.conflicts == reverse.conflicts


def test_insert_inside_unequal_replacement_conflicts() -> None:
    result = merge_file(
        file("a\nb\nc\nd\n"),
        file("a\nreplacement\nd\n"),
        file("a\nb\ninsert\nc\nd\n"),
    )
    assert result.outcome == "conflict"
    assert result.content is None
    assert result.conflicts[0].base_range == (1, 3)


@pytest.mark.parametrize("binary", [b"\x00", b"\xff", b"\x01", b"\x7f"])
def test_distinct_binary_changes_conflict_but_single_changes_work(
    binary,
) -> None:
    base, source, target = (
        file(binary + suffix) for suffix in (b"base", b"source", b"target")
    )
    result = merge_file(base, source, target)
    assert result.outcome == "conflict"
    assert result.conflicts[0].reason == "binary_conflict"
    assert (result.base, result.source, result.target) == (
        base,
        source,
        target,
    )
    assert merge_file(base, source, base).version == source


@pytest.mark.parametrize(
    "source,target", [(None, file("changed")), (file("changed"), None)]
)
def test_delete_modify_conflicts(source, target) -> None:
    result = merge_file(file("base"), source, target)
    assert result.outcome == "conflict"
    assert result.conflicts[0].reason == "delete_modify"


def test_add_add_is_not_treated_as_two_insertions_into_empty_file() -> None:
    result = merge_file(None, file("one\n"), file("two\n"))
    assert result.outcome == "conflict"
    assert result.conflicts[0].reason == "add_add"
    assert merge_file(None, file(""), None).version == file("")
    assert merge_file(file(""), None, file("")).version is None


def test_independent_mode_and_content_changes_combine() -> None:
    for content in (b"text\n", b"\x00binary"):
        base = file(content)
        source = file(content, mode=0o755)
        target = file(content + b"changed")
        for left, right in ((source, target), (target, source)):
            result = merge_file(base, left, right)
            assert result.outcome == "merged"
            assert result.version == file(target.content, mode=0o755)


def test_identical_mode_changes_can_merge_other_text_changes() -> None:
    result = merge_file(
        file("a\nb\n"),
        file("A\nb\n", mode=0o755),
        file("a\nB\n", mode=0o755),
    )
    assert result.version == file("A\nB\n", mode=0o755)


def test_conflicting_modes_are_not_arbitrarily_chosen() -> None:
    result = merge_file(
        file("base"), file("base", mode=0o755), file("base", mode=0o600)
    )
    assert result.outcome == "conflict"
    assert result.conflicts[0].reason == "mode_conflict"


@pytest.mark.parametrize(
    "base,source,target",
    [
        (file("base"), FileVersion("symlink", b"link", 0o777), file("target")),
        (
            FileVersion("symlink", b"old", 0o777),
            FileVersion("symlink", b"source", 0o777),
            FileVersion("symlink", b"target", 0o777),
        ),
        (
            FileVersion("symlink", b"old", 0o777),
            file("source"),
            file("target"),
        ),
    ],
)
def test_concurrent_kind_or_symlink_changes_are_conservative(
    base, source, target
) -> None:
    result = merge_file(base, source, target)
    assert result.outcome == "conflict"
    assert result.conflicts[0].reason == "kind_conflict"


def test_explicit_path_group_retains_rename_members_without_guessing() -> None:
    group = MergePathGroup("rename-1", ("old.txt", "new.txt"))
    assert group.paths == ("old.txt", "new.txt")
    with pytest.raises(FrozenInstanceError):
        group.group_id = "other"
    with pytest.raises(FrozenInstanceError):
        file("content").content = b"changed"


@pytest.mark.parametrize(
    "paths",
    [(), ("a", "a"), ("/absolute",), ("a/../b",), ("a\\b",), ("a//b",)],
)
def test_path_group_rejects_ambiguous_paths(paths) -> None:
    with pytest.raises(ValueError):
        MergePathGroup("group", paths)


def test_file_version_rejects_mutable_bytes_and_non_permission_modes() -> None:
    with pytest.raises(TypeError):
        FileVersion("file", bytearray(b"mutable"))
    with pytest.raises(ValueError):
        FileVersion("file", b"content", 0o100644)
