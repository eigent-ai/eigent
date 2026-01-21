"""Unit tests for RAGToolkit."""
import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import tempfile
import shutil

from app.utils.toolkit.rag_toolkit import RAGToolkit, DEFAULT_STORAGE_PATH


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
        """Create a RAGToolkit instance with mocked dependencies."""
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task-123",
                storage_path=temp_storage_path,
            )
            return toolkit

    def test_toolkit_initialization(self, temp_storage_path):
        """Test RAGToolkit initializes correctly."""
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task-456",
                storage_path=temp_storage_path,
            )
            
            assert toolkit.api_task_id == "test-task-456"
            assert toolkit.collection_name == "task_test-task-456"
            assert toolkit.storage_path == temp_storage_path
            assert temp_storage_path.exists()

    def test_toolkit_initialization_with_custom_collection(self, temp_storage_path):
        """Test RAGToolkit with custom collection name."""
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                collection_name="my-custom-kb",
                storage_path=temp_storage_path,
            )
            
            assert toolkit.collection_name == "my-custom-kb"

    def test_toolkit_initialization_with_custom_agent(self, temp_storage_path):
        """Test RAGToolkit with custom agent name."""
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                agent_name="custom_agent",
                storage_path=temp_storage_path,
            )
            
            assert toolkit.agent_name == "custom_agent"

    def test_add_document_empty_content(self, toolkit):
        """Test add_document with empty content returns error."""
        result = toolkit.add_document("")
        assert "Error" in result
        assert "empty" in result.lower()

    def test_add_document_whitespace_only(self, toolkit):
        """Test add_document with whitespace-only content returns error."""
        result = toolkit.add_document("   \n\t  ")
        assert "Error" in result

    def test_query_empty_query(self, toolkit):
        """Test query_knowledge_base with empty query returns error."""
        result = toolkit.query_knowledge_base("")
        assert "Error" in result
        assert "empty" in result.lower()

    def test_list_knowledge_bases_empty(self, temp_storage_path):
        """Test list_knowledge_bases when no KBs exist."""
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )
            
            result = toolkit.list_knowledge_bases()
            assert "No knowledge bases found" in result

    def test_get_tools_returns_three_tools(self, toolkit):
        """Test get_tools returns all three RAG tools."""
        tools = toolkit.get_tools()
        
        assert len(tools) == 3
        tool_names = [t.func.__name__ for t in tools]
        assert "add_document" in tool_names
        assert "query_knowledge_base" in tool_names
        assert "list_knowledge_bases" in tool_names

    def test_get_can_use_tools_without_api_key(self, temp_storage_path):
        """Test get_can_use_tools returns empty when no API key."""
        with patch.dict('os.environ', {}, clear=True):
            with patch('app.utils.toolkit.rag_toolkit.env', return_value=None):
                tools = RAGToolkit.get_can_use_tools("test-task")
                assert tools == []

    def test_get_can_use_tools_with_api_key(self, temp_storage_path):
        """Test get_can_use_tools returns tools when API key is set."""
        with patch('app.utils.toolkit.rag_toolkit.env', return_value='test-key'):
            with patch.object(RAGToolkit, 'get_tools') as mock_get_tools:
                mock_get_tools.return_value = [Mock(), Mock(), Mock()]
                tools = RAGToolkit.get_can_use_tools("test-task")
                assert len(tools) == 3

    def test_toolkit_name(self):
        """Test toolkit_name returns correct name."""
        name = RAGToolkit.toolkit_name()
        assert name == "Rag Toolkit"

    def test_default_storage_path_exists(self):
        """Test DEFAULT_STORAGE_PATH is defined correctly."""
        assert DEFAULT_STORAGE_PATH is not None
        assert ".eigent" in str(DEFAULT_STORAGE_PATH)
        assert "rag_storage" in str(DEFAULT_STORAGE_PATH)


class TestRAGToolkitIntegration:
    """Integration tests for RAGToolkit (requires mocking CAMEL components)."""

    @pytest.fixture
    def temp_storage_path(self):
        """Create a temporary storage path for tests."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)

    @patch('app.utils.toolkit.rag_toolkit.OpenAIEmbedding')
    @patch('app.utils.toolkit.rag_toolkit.QdrantStorage')
    @patch('app.utils.toolkit.rag_toolkit.VectorRetriever')
    def test_add_document_success(
        self,
        mock_retriever_class,
        mock_storage_class,
        mock_embedding_class,
        temp_storage_path
    ):
        """Test successful document addition."""
        # Setup mocks
        mock_retriever = MagicMock()
        mock_retriever_class.return_value = mock_retriever
        mock_storage_class.return_value = MagicMock()
        mock_embedding_class.return_value = MagicMock()
        
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )
            
            result = toolkit.add_document(
                content="This is test content for RAG.",
                metadata={"source": "test"},
                doc_id="doc-001"
            )
            
            assert "Successfully added" in result
            assert "doc-001" in result
            # Verify process was called with extra_info (CAMEL's parameter name)
            mock_retriever.process.assert_called_once()
            call_kwargs = mock_retriever.process.call_args[1]
            assert "extra_info" in call_kwargs
            assert call_kwargs["extra_info"]["doc_id"] == "doc-001"

    @patch('app.utils.toolkit.rag_toolkit.OpenAIEmbedding')
    @patch('app.utils.toolkit.rag_toolkit.QdrantStorage')
    @patch('app.utils.toolkit.rag_toolkit.VectorRetriever')
    def test_query_knowledge_base_success(
        self,
        mock_retriever_class,
        mock_storage_class,
        mock_embedding_class,
        temp_storage_path
    ):
        """Test successful knowledge base query."""
        # Setup mocks
        mock_retriever = MagicMock()
        mock_retriever.query.return_value = [
            {"text": "Relevant content 1", "score": 0.95, "metadata": {"doc_id": "doc1"}},
            {"text": "Relevant content 2", "score": 0.85, "metadata": {"doc_id": "doc2"}},
        ]
        mock_retriever_class.return_value = mock_retriever
        mock_storage_class.return_value = MagicMock()
        mock_embedding_class.return_value = MagicMock()
        
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )
            
            result = toolkit.query_knowledge_base("What is the content?", top_k=3)
            
            assert "Relevant content 1" in result
            assert "Relevant content 2" in result
            assert "0.95" in result  # Score should be included
            mock_retriever.query.assert_called_once_with(query="What is the content?", top_k=3)

    @patch('app.utils.toolkit.rag_toolkit.OpenAIEmbedding')
    @patch('app.utils.toolkit.rag_toolkit.QdrantStorage')
    @patch('app.utils.toolkit.rag_toolkit.VectorRetriever')
    def test_query_knowledge_base_no_results(
        self,
        mock_retriever_class,
        mock_storage_class,
        mock_embedding_class,
        temp_storage_path
    ):
        """Test query with no results."""
        # Setup mocks
        mock_retriever = MagicMock()
        mock_retriever.query.return_value = []
        mock_retriever_class.return_value = mock_retriever
        mock_storage_class.return_value = MagicMock()
        mock_embedding_class.return_value = MagicMock()
        
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            toolkit = RAGToolkit(
                api_task_id="test-task",
                storage_path=temp_storage_path,
            )
            
            result = toolkit.query_knowledge_base("Unknown query")
            
            assert "No relevant information found" in result
