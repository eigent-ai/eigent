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
"""Unit tests for Chat and AgentModelConfig model configuration."""

from app.model.chat import AgentModelConfig, Chat, NewAgent


class TestAgentModelConfig:
    """Tests for the AgentModelConfig model."""

    def test_agent_model_config_creation_empty(self):
        """Test creating an empty AgentModelConfig."""
        config = AgentModelConfig()
        assert config.model_platform is None
        assert config.model_type is None
        assert config.api_key is None
        assert config.api_url is None
        assert config.extra_params is None

    def test_agent_model_config_creation_with_values(self):
        """Test creating an AgentModelConfig with values."""
        config = AgentModelConfig(
            model_platform="openai",
            model_type="gpt-4",
            api_key="test-key",
            api_url="https://api.openai.com/v1",
            extra_params={"temperature": 0.7},
        )
        assert config.model_platform == "openai"
        assert config.model_type == "gpt-4"
        assert config.api_key == "test-key"
        assert config.api_url == "https://api.openai.com/v1"
        assert config.extra_params == {"temperature": 0.7}

    def test_has_custom_config_false_when_empty(self):
        """Test has_custom_config returns False for empty config."""
        config = AgentModelConfig()
        assert config.has_custom_config() is False

    def test_has_custom_config_true_with_platform(self):
        """Test has_custom_config returns True when platform is set."""
        config = AgentModelConfig(model_platform="anthropic")
        assert config.has_custom_config() is True

    def test_has_custom_config_true_with_model_type(self):
        """Test has_custom_config returns True when model_type is set."""
        config = AgentModelConfig(model_type="claude-3-opus")
        assert config.has_custom_config() is True

    def test_has_custom_config_true_with_both(self):
        """Test has_custom_config returns True when both are set."""
        config = AgentModelConfig(
            model_platform="anthropic", model_type="claude-3-opus"
        )
        assert config.has_custom_config() is True

    def test_has_custom_config_true_with_only_api_key(self):
        """Test has_custom_config returns True with only api_key."""
        config = AgentModelConfig(api_key="some-key")
        assert config.has_custom_config() is True


class TestNewAgentWithModelConfig:
    """Tests for NewAgent with custom_model_config."""

    def test_new_agent_without_model_config(self):
        """Test NewAgent creation without custom model config."""
        agent = NewAgent(
            name="TestAgent",
            description="A test agent",
            tools=[],
            mcp_tools=None,
        )
        assert agent.name == "TestAgent"
        assert agent.custom_model_config is None

    def test_new_agent_with_model_config(self):
        """Test NewAgent creation with custom model config."""
        model_config = AgentModelConfig(
            model_platform="openai", model_type="gpt-4-turbo"
        )
        agent = NewAgent(
            name="CustomModelAgent",
            description="An agent with custom model",
            tools=[],
            mcp_tools=None,
            custom_model_config=model_config,
        )
        assert agent.name == "CustomModelAgent"
        assert agent.custom_model_config is not None
        assert agent.custom_model_config.model_platform == "openai"
        assert agent.custom_model_config.model_type == "gpt-4-turbo"

    def test_new_agent_serialization_with_model_config(self):
        """Test NewAgent serialization includes model config."""
        model_config = AgentModelConfig(
            model_platform="anthropic", model_type="claude-3-sonnet"
        )
        agent = NewAgent(
            name="SerializationTest",
            description="Test serialization",
            tools=[],
            mcp_tools=None,
            custom_model_config=model_config,
        )
        data = agent.model_dump()
        assert "custom_model_config" in data
        assert data["custom_model_config"]["model_platform"] == "anthropic"
        assert data["custom_model_config"]["model_type"] == "claude-3-sonnet"


class TestModelPlatformMapping:
    """Tests for model platform aliases mapped in backend."""

    def _create_chat(self, model_platform: str) -> Chat:
        return Chat(
            task_id="task-1",
            project_id="project-1",
            question="test question",
            email="tester@example.com",
            model_platform=model_platform,
            model_type="gpt-4o",
            api_key="test-key",
            api_url="https://api.example.com/v1",
        )

    def test_chat_maps_grok_to_openai_compatible_model(self):
        """Test Chat maps grok platform alias correctly."""
        chat = self._create_chat("grok")
        assert chat.model_platform == "openai-compatible-model"

    def test_chat_keeps_supported_platforms_unchanged(self):
        """Test Chat keeps native camel-ai platforms unchanged."""
        chat = self._create_chat("mistral")
        assert chat.model_platform == "mistral"
        chat = self._create_chat("samba-nova")
        assert chat.model_platform == "samba-nova"

    def test_agent_model_config_maps_grok_alias(self):
        """Test AgentModelConfig also maps grok alias for per-agent overrides."""
        config = AgentModelConfig(model_platform="grok")
        assert config.model_platform == "openai-compatible-model"

    def test_agent_model_config_keeps_supported_platforms_unchanged(self):
        """Test AgentModelConfig keeps native camel-ai platforms unchanged."""
        config = AgentModelConfig(model_platform="mistral")
        assert config.model_platform == "mistral"
        config = AgentModelConfig(model_platform="samba-nova")
        assert config.model_platform == "samba-nova"
