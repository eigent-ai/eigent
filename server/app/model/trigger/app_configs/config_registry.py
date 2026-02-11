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
Trigger Config Registry

Registry for mapping trigger types to their configuration classes.
Used for validation and JSON schema generation.
"""

from typing import Type, Optional, Dict, Any, TYPE_CHECKING

from app.type.trigger_types import TriggerType
from app.model.trigger.app_configs.base_config import BaseTriggerConfig
from app.model.trigger.app_configs.slack_config import SlackTriggerConfig
from app.model.trigger.app_configs.webhook_config import WebhookTriggerConfig
from app.model.trigger.app_configs.schedule_config import ScheduleTriggerConfig

if TYPE_CHECKING:
    from sqlmodel import Session


# Registry of trigger types to their config classes
_CONFIG_REGISTRY: Dict[TriggerType, Type[BaseTriggerConfig]] = {
    TriggerType.slack_trigger: SlackTriggerConfig,
    TriggerType.webhook: WebhookTriggerConfig,
    TriggerType.schedule: ScheduleTriggerConfig,
}


def get_config_class(trigger_type: TriggerType) -> Optional[Type[BaseTriggerConfig]]:
    """
    Get the config class for a trigger type.
    
    Args:
        trigger_type: The trigger type to get config class for
        
    Returns:
        The Pydantic model class for the trigger config, or None if not found
    """
    return _CONFIG_REGISTRY.get(trigger_type)


def register_config_class(trigger_type: TriggerType, config_class: Type[BaseTriggerConfig]):
    """
    Register a config class for a trigger type.
    
    Args:
        trigger_type: The trigger type to register
        config_class: The Pydantic model class for the trigger config
    """
    _CONFIG_REGISTRY[trigger_type] = config_class


def get_config_schema(trigger_type: TriggerType) -> Optional[Dict[str, Any]]:
    """
    Get the JSON schema for a trigger type's config.
    
    Args:
        trigger_type: The trigger type to get schema for
        
    Returns:
        The JSON schema dict, or None if no config class is registered
    """
    config_class = get_config_class(trigger_type)
    if config_class:
        return config_class.model_json_schema()
    return None


def validate_config(trigger_type: TriggerType, config_data: Optional[dict]) -> Optional[BaseTriggerConfig]:
    """
    Validate config data against the registered config class.
    
    Args:
        trigger_type: The trigger type to validate for
        config_data: The config data to validate
        
    Returns:
        The validated Pydantic model instance, or None if no config class is registered
        
    Raises:
        ValidationError: If the config data is invalid
    """
    if config_data is None:
        return None
        
    config_class = get_config_class(trigger_type)
    if config_class:
        return config_class(**config_data)
    return None


def get_supported_config_types() -> list[TriggerType]:
    """Get list of trigger types that have config classes registered."""
    return list(_CONFIG_REGISTRY.keys())


def has_config(trigger_type: TriggerType) -> bool:
    """Check if a trigger type has a config class registered."""
    return trigger_type in _CONFIG_REGISTRY


def requires_authentication(trigger_type: TriggerType, config_data: Optional[dict] = None) -> bool:
    """
    Check if a trigger type requires authentication.
    
    Args:
        trigger_type: The trigger type to check
        config_data: Optional config data to check against
        
    Returns:
        True if authentication is required, False otherwise
    """
    config_class = get_config_class(trigger_type)
    
    if not config_class:
        return False
    
    config = config_class(**(config_data or {}))
    return config.authentication_required


def validate_activation(
    trigger_type: TriggerType,
    config_data: Optional[dict],
    user_id: int,
    session: "Session"
) -> None:
    """
    Validate that a trigger can be activated. Raises an exception if not.
    
    Args:
        trigger_type: The trigger type to validate
        config_data: The config data for the trigger
        user_id: The ID of the user who owns the trigger
        session: Database session for querying credentials
        
    Raises:
        ActivationError: If activation requirements are not met
    """
    config_class = get_config_class(trigger_type)
    
    if not config_class:
        return  # No requirements to check
    
    config = config_class(**(config_data or {}))
    config.validate_activation(user_id, session)