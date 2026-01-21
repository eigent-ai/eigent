"""Unit tests for AgentModelConfig and per-agent model configuration."""
import pytest
from app.model.chat import AgentModelConfig, NewAgent


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
            extra_params={"temperature": 0.7}
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
            model_platform="anthropic",
            model_type="claude-3-opus"
        )
        assert config.has_custom_config() is True

    def test_has_custom_config_false_with_only_api_key(self):
        """Test has_custom_config returns False with only api_key."""
        config = AgentModelConfig(api_key="some-key")
        assert config.has_custom_config() is False


class TestNewAgentWithModelConfig:
    """Tests for NewAgent with model_config_override."""

    def test_new_agent_without_model_config(self):
        """Test NewAgent creation without model config override."""
        agent = NewAgent(
            name="TestAgent",
            description="A test agent",
            tools=["search", "code"],
            mcp_tools=None
        )
        assert agent.name == "TestAgent"
        assert agent.model_config_override is None

    def test_new_agent_with_model_config(self):
        """Test NewAgent creation with model config override."""
        model_config = AgentModelConfig(
            model_platform="openai",
            model_type="gpt-4-turbo"
        )
        agent = NewAgent(
            name="CustomModelAgent",
            description="An agent with custom model",
            tools=["file"],
            mcp_tools=None,
            model_config_override=model_config
        )
        assert agent.name == "CustomModelAgent"
        assert agent.model_config_override is not None
        assert agent.model_config_override.model_platform == "openai"
        assert agent.model_config_override.model_type == "gpt-4-turbo"

    def test_new_agent_serialization_with_model_config(self):
        """Test NewAgent serialization includes model config."""
        model_config = AgentModelConfig(
            model_platform="anthropic",
            model_type="claude-3-sonnet"
        )
        agent = NewAgent(
            name="SerializableAgent",
            description="Test serialization",
            tools=[],
            mcp_tools=None,
            model_config_override=model_config
        )
        data = agent.model_dump()
        assert "model_config_override" in data
        assert data["model_config_override"]["model_platform"] == "anthropic"
        assert data["model_config_override"]["model_type"] == "claude-3-sonnet"
