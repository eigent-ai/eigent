"""RAG (Retrieval-Augmented Generation) Toolkit for knowledge base queries.

This toolkit wraps CAMEL's RetrievalToolkit with eigent-specific features:
- Task-based collection isolation
- Persistent storage per project
- Integration with eigent's toolkit system
- Raw text document support (add_document + query_knowledge_base)

Uses composition to leverage CAMEL's existing RAG infrastructure while
maintaining compatibility with eigent's AbstractToolkit system.
"""
import hashlib
import os
from pathlib import Path
from typing import List, Optional, Union

from camel.embeddings import OpenAIEmbedding
from camel.retrievers import AutoRetriever, VectorRetriever
from camel.storages import QdrantStorage
from camel.toolkits import RetrievalToolkit
from camel.toolkits.function_tool import FunctionTool
from camel.types import StorageType

from app.component.environment import env
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("rag_toolkit")

# Default storage path for vector databases
DEFAULT_STORAGE_PATH = Path(os.path.expanduser("~/.eigent/rag_storage"))


class RAGToolkit(AbstractToolkit):
    """Eigent-specific RAG toolkit wrapping CAMEL's RetrievalToolkit.
    
    Uses composition to wrap CAMEL's RetrievalToolkit, adding eigent-specific features:
    - Task-based collection isolation (each task gets its own knowledge base)
    - Persistent local storage
    - Integration with eigent's AbstractToolkit system
    - Raw text document support via add_document + query_knowledge_base
    """
    
    agent_name: str = Agents.task_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        storage_path: Path | None = None,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        
        self.storage_path = storage_path or DEFAULT_STORAGE_PATH
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._task_storage_path = self.storage_path / f"task_{api_task_id}"
        
        # Initialize CAMEL's AutoRetriever with task-isolated storage
        auto_retriever = AutoRetriever(
            vector_storage_local_path=str(self._task_storage_path),
            storage_type=StorageType.QDRANT,
        )
        
        # Wrap CAMEL's RetrievalToolkit using composition (for file/URL retrieval)
        self._retrieval_toolkit = RetrievalToolkit(auto_retriever=auto_retriever)
        
        # Lazy-initialized components for raw text support
        self._embedding_model = None
        self._vector_retriever = None
        self._storage = None

    def _get_embedding_model(self):
        """Lazily initialize embedding model."""
        if self._embedding_model is None:
            api_key = env("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY is required for RAG embeddings")
            self._embedding_model = OpenAIEmbedding(api_key=api_key)
        return self._embedding_model

    def _get_storage(self):
        """Lazily initialize vector storage for raw text."""
        if self._storage is None:
            self._task_storage_path.mkdir(parents=True, exist_ok=True)
            self._storage = QdrantStorage(
                vector_dim=1536,  # OpenAI embedding dimension
                path=str(self._task_storage_path / "raw_text"),
                collection_name=f"task_{self.api_task_id}_raw",
            )
        return self._storage

    def _get_vector_retriever(self) -> VectorRetriever:
        """Lazily initialize vector retriever for raw text."""
        if self._vector_retriever is None:
            self._vector_retriever = VectorRetriever(
                embedding_model=self._get_embedding_model(),
                storage=self._get_storage(),
            )
        return self._vector_retriever

    def information_retrieval(
        self,
        query: str,
        contents: Union[str, List[str]],
        top_k: int = 5,
        similarity_threshold: float = 0.5,
    ) -> str:
        """Retrieves information from a local vector storage based on the query.
        
        This method connects to a task-isolated vector storage and retrieves
        relevant information. Content is automatically indexed on first use.

        Args:
            query: The question or query for which an answer is required.
            contents: Local file paths, remote URLs, or string contents to search.
            top_k: Number of top results to return (default: 5).
            similarity_threshold: Minimum similarity score for results (default: 0.5).

        Returns:
            The information retrieved in response to the query.

        Example:
            information_retrieval(
                query="What are the main features?",
                contents="/path/to/document.pdf"
            )
        """
        try:
            result = self._retrieval_toolkit.information_retrieval(
                query=query,
                contents=contents,
                top_k=top_k,
                similarity_threshold=similarity_threshold,
            )
            logger.info(f"Retrieved information for query in task {self.api_task_id}")
            return result
        except Exception as e:
            logger.error(f"Failed to retrieve information: {e}", exc_info=True)
            return f"Error retrieving information: {str(e)}"

    def add_document(
        self,
        content: str,
        metadata: Optional[dict] = None,
        doc_id: Optional[str] = None,
    ) -> str:
        """Add a raw text document to the knowledge base.
        
        This method allows adding text content directly without requiring a file.
        Useful for adding API responses, conversation snippets, or any text data.

        Args:
            content: The text content to add to the knowledge base.
            metadata: Optional metadata to associate with the document
                (e.g., source, title, date).
            doc_id: Optional unique identifier for the document.
                If not provided, a hash of the content will be used.

        Returns:
            A confirmation message with the document ID.

        Example:
            add_document(
                content="Python is a programming language.",
                metadata={"source": "wiki"},
                doc_id="doc-001"
            )
        """
        try:
            if not content or not content.strip():
                return "Error: Cannot add empty document"
            
            # Generate document ID if not provided
            if doc_id is None:
                doc_id = hashlib.md5(content.encode()).hexdigest()[:12]
            
            # Prepare metadata
            doc_metadata = metadata or {}
            doc_metadata["doc_id"] = doc_id
            doc_metadata["task_id"] = self.api_task_id
            
            # Get vector retriever and add content
            retriever = self._get_vector_retriever()
            retriever.process(content=content, extra_info=doc_metadata)
            
            logger.info(f"Added document {doc_id} to task {self.api_task_id}")
            return f"Successfully added document (ID: {doc_id}) to knowledge base"
            
        except Exception as e:
            logger.error(f"Failed to add document: {e}", exc_info=True)
            return f"Error adding document: {str(e)}"

    def query_knowledge_base(
        self,
        query: str,
        top_k: int = 5,
    ) -> str:
        """Query the knowledge base for relevant information from added documents.
        
        This queries documents previously added via add_document().
        For querying files/URLs, use information_retrieval() instead.

        Args:
            query: The question or search query to find relevant documents.
            top_k: Maximum number of relevant chunks to return (default: 5).

        Returns:
            Retrieved relevant text chunks from the knowledge base,
            or a message if no relevant information is found.

        Example:
            query_knowledge_base(query="What is Python?", top_k=3)
        """
        try:
            if not query or not query.strip():
                return "Error: Query cannot be empty"
            
            retriever = self._get_vector_retriever()
            results = retriever.query(query=query, top_k=top_k)
            
            if not results:
                return f"No relevant information found for query: {query}"
            
            # Format results
            formatted_results = []
            for i, result in enumerate(results, 1):
                text = result.get("text", result.get("content", ""))
                score = result.get("score", result.get("similarity", "N/A"))
                metadata = result.get("metadata", {})
                
                # Format score
                if isinstance(score, (int, float)):
                    score_str = f"{score:.3f}"
                else:
                    score_str = str(score)
                
                result_text = f"[Result {i}] (relevance: {score_str})\n{text}"
                if metadata:
                    source = metadata.get("source", metadata.get("doc_id", ""))
                    if source:
                        result_text += f"\n(Source: {source})"
                formatted_results.append(result_text)
            
            logger.info(f"Retrieved {len(results)} results for query in task {self.api_task_id}")
            return "\n\n---\n\n".join(formatted_results)
            
        except Exception as e:
            logger.error(f"Failed to query knowledge base: {e}", exc_info=True)
            return f"Error querying knowledge base: {str(e)}"

    def list_knowledge_bases(self) -> str:
        """List all available knowledge bases.
        
        Returns:
            A list of available knowledge base collection names.
        """
        try:
            collections = []
            if self.storage_path.exists():
                for item in self.storage_path.iterdir():
                    if item.is_dir() and item.name.startswith("task_"):
                        collections.append(item.name)
            
            if not collections:
                return "No knowledge bases found. Use add_document or information_retrieval to create one."
            
            return "Available knowledge bases:\n" + "\n".join(f"- {c}" for c in sorted(collections))
            
        except Exception as e:
            logger.error(f"Failed to list knowledge bases: {e}", exc_info=True)
            return f"Error listing knowledge bases: {str(e)}"

    def get_tools(self) -> List[FunctionTool]:
        """Return the list of tools provided by this toolkit."""
        return [
            FunctionTool(self.add_document),
            FunctionTool(self.query_knowledge_base),
            FunctionTool(self.information_retrieval),
            FunctionTool(self.list_knowledge_bases),
        ]

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """Return tools that can be used based on available configuration."""
        # RAG requires OpenAI API key for embeddings
        if not env("OPENAI_API_KEY"):
            logger.debug("RAG toolkit disabled: OPENAI_API_KEY not set")
            return []
        
        toolkit = RAGToolkit(api_task_id)
        return toolkit.get_tools()
