"""RAG (Retrieval-Augmented Generation) Toolkit for knowledge base queries.

This toolkit provides document ingestion and retrieval capabilities using
CAMEL's built-in RAG infrastructure with local vector storage.
"""
import os
import hashlib
from pathlib import Path
from typing import List, Optional

from camel.embeddings import OpenAIEmbedding
from camel.retrievers import VectorRetriever
from camel.storages import QdrantStorage
from camel.toolkits import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.component.environment import env
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("rag_toolkit")

# Default storage path for vector databases
DEFAULT_STORAGE_PATH = Path(os.path.expanduser("~/.eigent/rag_storage"))


class RAGToolkit(BaseToolkit, AbstractToolkit):
    """Toolkit for RAG-based knowledge retrieval.
    
    Provides tools to:
    - Add documents to a knowledge base
    - Query the knowledge base for relevant information
    - List available knowledge bases
    """
    
    agent_name: str = Agents.task_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        collection_name: str | None = None,
        storage_path: Path | None = None,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        
        self.storage_path = storage_path or DEFAULT_STORAGE_PATH
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        # Use task_id as default collection name for isolation
        self.collection_name = collection_name or f"task_{api_task_id}"
        
        # Initialize embedding model
        self._embedding_model = None
        self._retriever = None
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
        """Lazily initialize vector storage."""
        if self._storage is None:
            storage_file = self.storage_path / f"{self.collection_name}.qdrant"
            self._storage = QdrantStorage(
                vector_dim=1536,  # OpenAI embedding dimension
                path=str(storage_file),
                collection_name=self.collection_name,
            )
        return self._storage

    def _get_retriever(self) -> VectorRetriever:
        """Lazily initialize retriever."""
        if self._retriever is None:
            self._retriever = VectorRetriever(
                embedding_model=self._get_embedding_model(),
                storage=self._get_storage(),
            )
        return self._retriever

    def add_document(
        self,
        content: str,
        metadata: Optional[dict] = None,
        doc_id: Optional[str] = None,
    ) -> str:
        """Add a document to the knowledge base.
        
        Args:
            content: The text content to add to the knowledge base.
            metadata: Optional metadata to associate with the document
                (e.g., source, title, date).
            doc_id: Optional unique identifier for the document.
                If not provided, a hash of the content will be used.
        
        Returns:
            A confirmation message with the document ID.
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
            
            # Get retriever and add content
            retriever = self._get_retriever()
            
            # Process content into chunks and store
            retriever.process(
                content=content,
                extra_info=doc_metadata,
            )
            
            logger.info(f"Added document {doc_id} to collection {self.collection_name}")
            return f"Successfully added document (ID: {doc_id}) to knowledge base '{self.collection_name}'"
            
        except Exception as e:
            logger.error(f"Failed to add document: {e}", exc_info=True)
            return f"Error adding document: {str(e)}"

    def query_knowledge_base(
        self,
        query: str,
        top_k: int = 5,
    ) -> str:
        """Query the knowledge base for relevant information.
        
        Args:
            query: The question or search query to find relevant documents.
            top_k: Maximum number of relevant chunks to return (default: 5).
        
        Returns:
            Retrieved relevant text chunks from the knowledge base,
            or a message if no relevant information is found.
        """
        try:
            if not query or not query.strip():
                return "Error: Query cannot be empty"
            
            retriever = self._get_retriever()
            
            # Query the vector store
            results = retriever.query(
                query=query,
                top_k=top_k,
            )
            
            if not results:
                return f"No relevant information found in knowledge base '{self.collection_name}' for query: {query}"
            
            # Format results
            formatted_results = []
            for i, result in enumerate(results, 1):
                content = result.get("text", result.get("content", ""))
                score = result.get("score", result.get("similarity", "N/A"))
                metadata = result.get("metadata", {})
                
                # Format score - handle both float and string
                if isinstance(score, (int, float)):
                    score_str = f"{score:.3f}"
                else:
                    score_str = str(score)
                
                result_text = f"[Result {i}] (relevance: {score_str})\n{content}"
                if metadata:
                    source = metadata.get("source", metadata.get("doc_id", ""))
                    if source:
                        result_text += f"\n(Source: {source})"
                formatted_results.append(result_text)
            
            logger.info(f"Retrieved {len(results)} results for query in {self.collection_name}")
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
                    if item.suffix == ".qdrant" or item.is_dir():
                        name = item.stem if item.suffix == ".qdrant" else item.name
                        collections.append(name)
            
            if not collections:
                return "No knowledge bases found. Use add_document to create one."
            
            return "Available knowledge bases:\n" + "\n".join(f"- {c}" for c in sorted(collections))
            
        except Exception as e:
            logger.error(f"Failed to list knowledge bases: {e}", exc_info=True)
            return f"Error listing knowledge bases: {str(e)}"

    def get_tools(self) -> List[FunctionTool]:
        """Return the list of tools provided by this toolkit."""
        return [
            FunctionTool(self.add_document),
            FunctionTool(self.query_knowledge_base),
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
