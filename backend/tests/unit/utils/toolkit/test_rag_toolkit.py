"""Unit tests for RAGToolkit.

RAGToolkit is a generic RAG toolkit with configurable storage:
- Raw text document support (add_document + query_knowledge_base)
- File/URL retrieval via information_retrieval
- Configurable collection_name and storage_path for flexibility
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import tempfile
import shutil

from app.utils.toolkit.rag_toolkit import RAGToolkit


class TestRAGToolkit:
    """Tests for the RAGToolkit class."""

    @pytest.fixture
    def temp_storage_path(self):
        """Create a temporary storage path for tests."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def toolkit(self, temp_storage_path):
        """Create a RAGToolkit instance with mocked AutoRetriever."""
        with patch("app.utils.toolkit.rag_toolkit.AutoRetriever"):
            with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
                toolkit = RAGToolkit(
                    api_task_id="test-task-123",
                    storage_path=temp_storage_path,
                )
                return toolkit

    def test_toolkit_initialization(self, temp_storage_path):
        """Test RAGToolkit initializes correctly."""
        with patch("app.utils.toolkit.rag_toolkit.AutoRetriever") as mock_ar:
            with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
                toolkit = RAGToolkit(
                    api_task_id="test-task-456",
                    collection_name="test_collection",
                    storage_path=temp_storage_path,
                )

                assert toolkit.api_task_id == "test-task-456"
                assert toolkit._storage_path == temp_storage_path
                assert toolkit._collection_name == "test_collection"
                assert temp_storage_path.exists()
                # Verify AutoRetriever was initialized with configured path
                mock_ar.assert_called_once()
                call_kwargs = mock_ar.call_args[1]
                assert str(temp_storage_path) in call_kwargs["vector_storage_local_path"]

    def test_toolkit_initialization_with_custom_agent(self, temp_storage_path):
        """Test RAGToolkit with custom agent name."""
        with patch("app.utils.toolkit.rag_toolkit.AutoRetriever"):
            with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
                toolkit = RAGToolkit(
                    api_task_id="test-task",
                    agent_name="custom_agent",
                    storage_path=temp_storage_path,
                )

                assert toolkit.agent_name == "custom_agent"

    def test_list_knowledge_bases_empty(self, temp_storage_path):
        """Test list_knowledge_bases when no KBs exist."""
        with patch("app.utils.toolkit.rag_toolkit.AutoRetriever"):
            with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
                toolkit = RAGToolkit(
                    api_task_id="test-task",
                    storage_path=temp_storage_path,
                )

                result = toolkit.list_knowledge_bases()
                assert "No knowledge bases found" in result

    def test_list_knowledge_bases_with_tasks(self, temp_storage_path):
        """Test list_knowledge_bases when task directories exist."""
        # Create some task directories
        (temp_storage_path / "task_123").mkdir()
        (temp_storage_path / "task_456").mkdir()

        with patch("app.utils.toolkit.rag_toolkit.AutoRetriever"):
            with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
                toolkit = RAGToolkit(
                    api_task_id="test-task",
                    storage_path=temp_storage_path,
                )

                result = toolkit.list_knowledge_bases()
                assert "task_123" in result
                assert "task_456" in result

    def test_get_tools_returns_three_tools(self, toolkit):
        """Test get_tools returns RAG tools (excluding list_knowledge_bases)."""
        tools = toolkit.get_tools()

        # list_knowledge_bases is not exposed since with task isolation
        # each task has its own collection
        assert len(tools) == 3
        tool_names = [t.func.__name__ for t in tools]
        assert "add_document" in tool_names
        assert "query_knowledge_base" in tool_names
        assert "information_retrieval" in tool_names

    def test_get_can_use_tools_without_api_key(self, temp_storage_path):
        """Test get_can_use_tools returns empty when no API key."""
        with patch.dict("os.environ", {}, clear=True):
            with patch("app.utils.toolkit.rag_toolkit.env", return_value=None):
                tools = RAGToolkit.get_can_use_tools("test-task")
                assert tools == []

    def test_get_can_use_tools_with_api_key(self, temp_storage_path):
        """Test get_can_use_tools returns tools when API key is set."""
        with patch("app.utils.toolkit.rag_toolkit.env", return_value="test-key"):
            with patch("app.utils.toolkit.rag_toolkit.AutoRetriever"):
                with patch.object(RAGToolkit, "get_tools") as mock_get_tools:
                    mock_get_tools.return_value = [Mock(), Mock()]
                    tools = RAGToolkit.get_can_use_tools("test-task")
                    assert len(tools) == 2

    def test_default_collection_name(self, temp_storage_path):
        """Test default collection_name when not provided."""
        with patch("app.utils.toolkit.rag_toolkit.AutoRetriever"):
            with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
                toolkit = RAGToolkit(
                    api_task_id="test-task",
                    storage_path=temp_storage_path,
                )
                assert toolkit._collection_name == "default"


class TestRAGToolkitIntegration:
    """Integration tests for RAGToolkit with mocked CAMEL components."""

    @pytest.fixture
    def temp_storage_path(self):
        """Create a temporary storage path for tests."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)

    @patch("app.utils.toolkit.rag_toolkit.AutoRetriever")
    def test_information_retrieval_success(self, mock_auto_retriever_class, temp_storage_path):
        """Test successful information retrieval."""
        # Setup mocks
        mock_auto_retriever = MagicMock()
        mock_auto_retriever.run_vector_retriever.return_value = {"text": ["Relevant content about the query"]}
        mock_auto_retriever_class.return_value = mock_auto_retriever

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )

            result = toolkit.information_retrieval(
                query="What is the content?",
                contents="/path/to/document.pdf",
                top_k=5,
            )

            # Should return string representation of retrieved info
            assert isinstance(result, str)
            mock_auto_retriever.run_vector_retriever.assert_called_once()

    @patch("app.utils.toolkit.rag_toolkit.AutoRetriever")
    def test_information_retrieval_with_error(self, mock_auto_retriever_class, temp_storage_path):
        """Test information retrieval handles errors gracefully."""
        # Setup mock to raise an exception
        mock_auto_retriever = MagicMock()
        mock_auto_retriever.run_vector_retriever.side_effect = Exception("Test error")
        mock_auto_retriever_class.return_value = mock_auto_retriever

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )

            result = toolkit.information_retrieval(
                query="What is the content?",
                contents="/path/to/document.pdf",
            )

            assert "Error" in result
            assert "Test error" in result

    @patch("app.utils.toolkit.rag_toolkit.AutoRetriever")
    def test_information_retrieval_with_list_contents(self, mock_auto_retriever_class, temp_storage_path):
        """Test information retrieval with multiple content sources."""
        mock_auto_retriever = MagicMock()
        mock_auto_retriever.run_vector_retriever.return_value = {"text": ["Combined results from multiple sources"]}
        mock_auto_retriever_class.return_value = mock_auto_retriever

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )

            result = toolkit.information_retrieval(
                query="What is the content?",
                contents=["/path/to/doc1.pdf", "/path/to/doc2.pdf"],
            )

            assert isinstance(result, str)
            mock_auto_retriever.run_vector_retriever.assert_called_once()
