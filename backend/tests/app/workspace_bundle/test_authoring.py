from __future__ import annotations

import json

import pytest

from app.workspace_bundle import WorkspaceBundleAuthoringService
from app.workspace_config import WorkspaceBundleManifest


def test_save_review_extracts_requirement_names_without_local_values():
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "bundle_review",
                "name": "Review",
                "revision": 1,
            },
            "spec": {
                "models": {
                    "default": {
                        "modelRef": "provider://default",
                        "thinkingEffort": "medium",
                    }
                },
                "mcpServers": [
                    {
                        "id": "github",
                        "definition": "registry://mcp/github@1",
                        "secretSlots": ["mcp.github.oauth_token"],
                        "assignTo": [],
                    }
                ],
            },
        }
    )
    sentinel = "must-never-appear-in-review"

    review = WorkspaceBundleAuthoringService.review(
        manifest,
        mcp_config={
            "mcpServers": {
                "github": {
                    "env": {
                        "GITHUB_TOKEN": sentinel,
                        "LOG_LEVEL": "debug",
                    },
                    "headers": {"authorization": sentinel},
                }
            }
        },
    )

    encoded = json.dumps(review)
    assert sentinel not in encoded
    assert review["local_values_excluded"] == 3
    suggested = {
        item["name"]: item
        for item in review["requirements"]["suggested_environment_variables"]
    }
    assert suggested["GITHUB_TOKEN"]["sensitive"] is True
    assert suggested["LOG_LEVEL"]["sensitive"] is False
    assert "mcp.github.oauth_token" in review["requirements"]["secret_slots"]
    assert (
        "mcp.github.headers.authorization"
        in review["requirements"]["secret_slots"]
    )
    assert (
        "mcp.github.env.github_token"
        not in review["requirements"]["secret_slots"]
    )
    assert review["requirements"]["suggested_mcp_secret_slots"] == [
        {
            "mcp_id": "github",
            "secret_slots": ["mcp.github.headers.authorization"],
        }
    ]


@pytest.mark.parametrize(
    "legacy_environment",
    ["legacy-non-object-shape", None, 7, False],
)
def test_save_review_keeps_non_env_secret_slots_when_legacy_env_is_not_object(
    legacy_environment,
):
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "bundle_review",
                "name": "Review",
                "revision": 1,
            },
            "spec": {
                "models": {
                    "default": {
                        "modelRef": "provider://default",
                        "thinkingEffort": "medium",
                    }
                },
                "mcpServers": [
                    {
                        "id": "github",
                        "definition": "registry://mcp/github@1",
                        "secretSlots": [],
                        "assignTo": [],
                    }
                ],
            },
        }
    )
    sentinel = "must-never-appear-in-review"

    review = WorkspaceBundleAuthoringService.review(
        manifest,
        mcp_config={
            "mcpServers": {
                "github": {
                    "env": legacy_environment,
                    "headers": {"authorization": sentinel},
                    "argv": ["github-mcp", "--token", sentinel],
                }
            }
        },
    )

    assert sentinel not in json.dumps(review)
    assert review["requirements"]["suggested_mcp_secret_slots"] == [
        {
            "mcp_id": "github",
            "secret_slots": [
                "mcp.github.argv.2",
                "mcp.github.headers.authorization",
            ],
        }
    ]


def test_save_review_hardens_declared_environment_secret_without_value():
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "bundle_review",
                "name": "Review",
                "revision": 1,
            },
            "spec": {
                "models": {
                    "default": {
                        "modelRef": "provider://default",
                        "thinkingEffort": "medium",
                    }
                },
                "environment": {
                    "variables": [{"name": "GITHUB_TOKEN", "sensitive": False}]
                },
                "mcpServers": [
                    {
                        "id": "github",
                        "definition": "registry://mcp/github@1",
                        "secretSlots": [],
                        "assignTo": [],
                    }
                ],
            },
        }
    )

    review = WorkspaceBundleAuthoringService.review(
        manifest,
        mcp_config={
            "mcpServers": {"github": {"env": {"GITHUB_TOKEN": "not-returned"}}}
        },
    )

    assert (
        review["requirements"]["environment_variables"][0]["sensitive"] is True
    )
    assert (
        review["requirements"]["suggested_environment_variables"][0][
            "sensitive"
        ]
        is True
    )
    assert "not-returned" not in json.dumps(review)


def test_sensitive_environment_requirement_cannot_carry_example_value():
    payload = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_review",
            "name": "Review",
            "revision": 1,
        },
        "spec": {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            },
            "environment": {
                "variables": [
                    {
                        "name": "API_TOKEN",
                        "sensitive": True,
                        "example": "do-not-store-values-here",
                    }
                ]
            },
        },
    }

    try:
        WorkspaceBundleManifest.model_validate(payload)
    except ValueError as exc:
        assert "cannot contain examples" in str(exc)
    else:
        raise AssertionError("sensitive example value was accepted")


def _reference_manifest(*, skill=None, mcp=None, slots=()):
    return WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "reference-test",
                "name": "References",
                "revision": 1,
            },
            "spec": {
                "models": {"default": {"modelRef": "provider://default"}},
                "skills": [{"ref": skill}] if skill else [],
                "mcpServers": [
                    {"id": "test", "definition": mcp, "secretSlots": slots}
                ]
                if mcp
                else [],
            },
        }
    )


@pytest.fixture
def authoring_registry(tmp_path, monkeypatch):
    from app.service import mcp_config, skill_config_service, skill_service
    from app.workspace_config.global_resources import global_resource_ref

    skills = tmp_path / "skills"
    skill = skills / "test" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text(
        "---\nname: Test\ndescription: Test skill\n---\nInstructions"
    )
    account = tmp_path / "user_7" / "skills-config.json"
    account.parent.mkdir()
    account.write_text('{"skills": {"Test": {"enabled": true}}}')
    mcp = tmp_path / "mcp.json"
    mcp.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "test": {
                        "url": "https://example.invalid/mcp",
                        "headers": {"Authorization": "private-sentinel"},
                    }
                }
            }
        )
    )
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", skills)
    monkeypatch.setattr(skill_config_service, "EIGENT_ROOT", tmp_path)
    monkeypatch.setattr(mcp_config, "get_mcp_config_path", lambda: mcp)
    return (
        skill,
        mcp,
        global_resource_ref("skill", "test"),
        global_resource_ref("mcp", "test"),
    )


@pytest.mark.parametrize(
    "kind,ref,code",
    [
        ("skill", "registry://skills/missing@999", "unsupported"),
        ("mcp", "registry://unsupported/mcp/missing@999", "unsupported"),
        (
            "skill",
            "registry://global/skills/" + "0" * 64,
            "global_setup_required",
        ),
        ("mcp", "registry://global/mcp/" + "0" * 64, "global_setup_required"),
        ("skill", "registry://global/skills/not-a-digest", "malformed"),
        ("mcp", "registry://", "malformed"),
        ("skill", "registry://global/mcp/" + "0" * 64, "unsupported"),
    ],
)
def test_reference_findings_classify_without_claiming_remote_absence(
    authoring_registry, kind, ref, code
):
    manifest = _reference_manifest(**{kind: ref})
    findings = WorkspaceBundleAuthoringService.reference_findings(
        manifest, user_id=7
    )
    assert len(findings) == 1
    assert findings[0]["code"] == code
    assert findings[0]["reference"] == ref
    assert findings[0]["location"].startswith("spec.")
    assert "private-sentinel" not in json.dumps(findings)


def test_valid_global_and_bundle_references_preserve_author_review_digest(
    authoring_registry,
):
    _, _, skill, mcp = authoring_registry
    manifest = _reference_manifest(skill=skill, mcp=mcp)
    before = WorkspaceBundleAuthoringService.review(manifest)
    assert (
        WorkspaceBundleAuthoringService.reference_findings(manifest, user_id=7)
        == []
    )
    assert WorkspaceBundleAuthoringService.review(manifest) == before
    assert (
        WorkspaceBundleAuthoringService.reference_findings(
            _reference_manifest(
                skill="bundle://skills/test/SKILL.md", mcp="bundle://mcp.json"
            )
        )
        == []
    )  # Explicit asset selection is checked separately by Desktop.


def test_preflight_reads_current_global_configuration_each_time(
    authoring_registry,
):
    skill_path, mcp_path, skill, mcp = authoring_registry
    manifest = _reference_manifest(skill=skill, mcp=mcp)
    assert (
        WorkspaceBundleAuthoringService.reference_findings(manifest, user_id=7)
        == []
    )
    skill_path.unlink()
    skill_path.parent.rmdir()
    mcp_path.write_text('{"mcpServers": {}}')
    findings = WorkspaceBundleAuthoringService.reference_findings(
        manifest, user_id=7
    )
    assert [item["code"] for item in findings] == ["global_setup_required"] * 2


@pytest.mark.parametrize(
    "reason",
    [
        "global_configuration_invalid",
        "global_configuration_unavailable",
        "global_configuration_too_large",
        "global_skill_identity_required",
        "global_skill_invalid",  # Runtime also uses this for unreadable files.
    ],
)
def test_unverifiable_global_resources_are_not_reported_missing(
    authoring_registry, monkeypatch, reason
):
    from app.workspace_bundle import authoring
    from app.workspace_config.global_resources import GlobalResourceUnavailable

    def unavailable(*args, **kwargs):
        raise GlobalResourceUnavailable(reason)

    monkeypatch.setattr(authoring, "resolve_global_skill", unavailable)
    assert (
        WorkspaceBundleAuthoringService.reference_findings(
            _reference_manifest(skill=authoring_registry[2]), user_id=7
        )[0]["code"]
        == "verification_unavailable"
    )


def test_unsupported_global_mcp_secret_mapping_is_actionable(
    authoring_registry,
):
    assert (
        WorkspaceBundleAuthoringService.reference_findings(
            _reference_manifest(mcp=authoring_registry[3], slots=["token"])
        )[0]["code"]
        == "unsupported"
    )
