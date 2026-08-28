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
