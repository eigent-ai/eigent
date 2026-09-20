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

from app.domains.example_content.schema import ProviderCatalog


def bundled_catalog() -> ProviderCatalog:
    """Small connector-free fallback used only after provider transport failure."""

    return ProviderCatalog.model_validate(
        {
            "schema_version": 1,
            "provider_key": "eigent-bundled",
            "provider_version": "1",
            "enabled": True,
            "space_categories": [],
            "items": [
                {
                    "id": "workspace-research-brief",
                    "surfaces": ["workspace"],
                    "role_keys": ["*"],
                    "space_category_keys": ["*"],
                    "priority": 30,
                    "translations": {
                        "en": {
                            "title": "Create a research brief",
                            "summary": "Turn a topic into a concise, sourced briefing.",
                            "prompt": "Research this topic and prepare a concise brief with key findings, evidence, open questions, and recommended next steps.",
                        }
                    },
                },
                {
                    "id": "workspace-plan-project",
                    "surfaces": ["workspace"],
                    "role_keys": ["*"],
                    "space_category_keys": ["*"],
                    "priority": 20,
                    "translations": {
                        "en": {
                            "title": "Plan a project",
                            "summary": "Build a practical plan with milestones and risks.",
                            "prompt": "Create a practical project plan for this goal. Include milestones, owners, dependencies, risks, and the first three actions.",
                        }
                    },
                },
                {
                    "id": "workspace-compare-options",
                    "surfaces": ["workspace"],
                    "role_keys": ["*"],
                    "space_category_keys": ["*"],
                    "priority": 10,
                    "translations": {
                        "en": {
                            "title": "Compare options",
                            "summary": "Evaluate alternatives using explicit criteria.",
                            "prompt": "Compare the available options using clear criteria, evidence, tradeoffs, risks, and a final recommendation.",
                        }
                    },
                },
                {
                    "id": "automation-weekly-summary",
                    "surfaces": ["automation"],
                    "role_keys": ["*"],
                    "space_category_keys": ["*"],
                    "priority": 30,
                    "translations": {
                        "en": {
                            "title": "Prepare a weekly summary",
                            "summary": "Summarize progress, blockers, and next steps.",
                            "prompt": "Review the latest work in this Space and prepare a weekly summary of progress, blockers, decisions, and next steps.",
                            "automation_name": "Weekly progress summary",
                            "automation_description": "Prepare a concise weekly summary for this Space.",
                        }
                    },
                },
                {
                    "id": "automation-risk-review",
                    "surfaces": ["automation"],
                    "role_keys": ["*"],
                    "space_category_keys": ["*"],
                    "priority": 20,
                    "translations": {
                        "en": {
                            "title": "Review open risks",
                            "summary": "Surface new risks and unresolved blockers.",
                            "prompt": "Review recent work for new risks, unresolved blockers, and overdue follow-ups. Return a prioritized action list.",
                            "automation_name": "Risk and blocker review",
                        }
                    },
                },
                {
                    "id": "automation-action-items",
                    "surfaces": ["automation"],
                    "role_keys": ["*"],
                    "space_category_keys": ["*"],
                    "priority": 10,
                    "translations": {
                        "en": {
                            "title": "Collect action items",
                            "summary": "Compile unfinished actions into one checklist.",
                            "prompt": "Review recent activity and compile unfinished action items with owners, due dates when known, and relevant context.",
                            "automation_name": "Open action items",
                        }
                    },
                },
            ],
        }
    )
