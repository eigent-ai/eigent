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

"""
Webhook Trigger Configuration Models

Configuration models for generic webhook triggers. These are stored in the 
trigger's config field and used by the webhook controller for 
request filtering and payload normalization.
"""

import re
from typing import Optional, List
from pydantic import Field

from app.model.trigger.app_configs.base_config import BaseTriggerConfig


class WebhookTriggerConfig(BaseTriggerConfig):
    """
    Generic webhook trigger configuration.
    
    Extends BaseTriggerConfig with webhook-specific fields for filtering
    incoming requests based on headers, body content, or custom patterns.
    """
    
    # Override authentication_required to default to False for generic webhooks
    authentication_required: bool = Field(
        default=False,
        description="Whether authentication is required for this trigger",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.webhook.authentication_required.label",
            "ui:notice": "triggers.webhook.authentication_required.notice"
        },
    )
    
    # Content filtering
    body_contains: Optional[str] = Field(
        default=None,
        description="Only trigger if the request body contains this string",
        json_schema_extra={
            "ui:label": "triggers.webhook.body_contains.label",
            "ui:widget": "text-input",
            "ui:placeholder": "triggers.webhook.body_contains.placeholder",
            "ui:notice": "triggers.webhook.body_contains.notice",
            "minLength": 1,
            "maxLength": 500
        },
    )
    
    # Header filtering
    required_headers: List[str] = Field(
        default=[],
        description="List of headers that must be present in the request",
        json_schema_extra={
            "ui:label": "triggers.webhook.required_headers.label",
            "ui:widget": "multi-text-input",
            "ui:placeholder": "triggers.webhook.required_headers.placeholder",
            "ui:notice": "triggers.webhook.required_headers.notice",
            "pattern": "^[A-Za-z0-9-]+$",
            "maxLength": 100
        },
    )
    
    header_match: Optional[str] = Field(
        default=None,
        description="Regex pattern to match against request headers (format: Header-Name: pattern)",
        json_schema_extra={
            "ui:label": "triggers.webhook.header_match.label",
            "ui:widget": "text-input",
            "ui:placeholder": "triggers.webhook.header_match.placeholder",
            "ui:notice": "triggers.webhook.header_match.notice",
            "ui:validation": "regex",
            "maxLength": 500
        },
    )
    
    # Include full request metadata
    include_headers: bool = Field(
        default=False,
        description="Include request headers in the execution input",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.webhook.include_headers.label",
            "ui:notice": "triggers.webhook.include_headers.notice"
        },
    )
    
    include_query_params: bool = Field(
        default=True,
        description="Include query parameters in the execution input",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.webhook.include_query_params.label",
        },
    )
    
    include_request_metadata: bool = Field(
        default=False,
        description="Include request metadata (method, URL, client IP) in execution input",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.webhook.include_request_metadata.label",
            "ui:notice": "triggers.webhook.include_request_metadata.notice"
        },
    )
    
    def matches_body_filter(self, body: str) -> bool:
        """
        Check if the body matches the body_contains filter.
        
        Args:
            body: The request body as string
            
        Returns:
            True if no filter is set, or if the body contains the filter string
        """
        if self.body_contains is None:
            return True
        return self.body_contains in body
    
    def has_required_headers(self, headers: dict) -> bool:
        """
        Check if all required headers are present.
        
        Args:
            headers: Dict of request headers (case-insensitive check)
            
        Returns:
            True if all required headers are present
        """
        if not self.required_headers:
            return True
        
        # Normalize headers to lowercase for comparison
        lower_headers = {k.lower(): v for k, v in headers.items()}
        
        for required in self.required_headers:
            if required.lower() not in lower_headers:
                return False
        return True
    
    def matches_header_pattern(self, headers: dict) -> bool:
        """
        Check if headers match the header_match pattern.
        
        Args:
            headers: Dict of request headers
            
        Returns:
            True if no pattern is set, or if headers match the pattern
        """
        if self.header_match is None:
            return True
        
        # Parse pattern: "Header-Name: pattern"
        if ":" not in self.header_match:
            return True
        
        header_name, pattern = self.header_match.split(":", 1)
        header_name = header_name.strip()
        pattern = pattern.strip()
        
        # Find the header (case-insensitive)
        for key, value in headers.items():
            if key.lower() == header_name.lower():
                try:
                    return bool(re.search(pattern, str(value), re.IGNORECASE))
                except re.error:
                    return False
        
        return False  # Header not found
    
    def should_trigger(self, body: str, headers: dict, text: Optional[str] = None) -> tuple[bool, str]:
        """
        Check if all webhook filters pass.
        
        Args:
            body: Request body as string
            headers: Request headers dict
            text: Optional text content to check against message_filter
            
        Returns:
            Tuple of (should_trigger, reason)
        """
        # Check message_filter from base class
        if not self.matches_filter(text):
            return False, "message_filter_not_matched"
        
        # Check body_contains
        if not self.matches_body_filter(body):
            return False, "body_filter_not_matched"
        
        # Check required headers
        if not self.has_required_headers(headers):
            return False, "required_headers_missing"
        
        # Check header pattern
        if not self.matches_header_pattern(headers):
            return False, "header_pattern_not_matched"
        
        return True, "ok"

    @classmethod
    def validate_config(cls, config_data: dict) -> "WebhookTriggerConfig":
        """Validate and return a WebhookTriggerConfig instance."""
        return cls(**config_data)
