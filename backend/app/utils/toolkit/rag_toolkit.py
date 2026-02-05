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

import hashlib
import logging
import os
from pathlib import Path

from camel.embeddings import BaseEmbedding, OpenAIEmbedding
from camel.retrievers import AutoRetriever, VectorRetriever
from camel.storages import BaseVectorStorage, QdrantStorage
from camel.toolkits import RetrievalToolkit
from camel.toolkits.function_tool import FunctionTool
from camel.types import StorageType

from app.component.environment import env
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit

logger = logging.getLogger("rag_toolkit")

# Default paths and constants
DEFAULT_RAG_STORAGE_PATH = "~/.eigent/rag_storage"
DEFAULT_COLLECTION_NAME = "default"
RAW_TEXT_SUBDIR = "raw_text"
DEFAULT_STORAGE_TYPE = StorageType.QDRANT
DEFAULT_EMBEDDING_DIM = 1536  # OpenAI text-embedding-ada-002 dimension


class RAGToolkit(AbstractToolkit):
    """Generic RAG toolkit wrapping CAMEL's RetrievalToolkit.

    This toolkit provides RAG functionality with configurable storage:
    - Raw text document support via add_document + query_knowledge_base
    - File/URL retrieval via information_retrieval
    - Configurable collection_name and storage_path for flexibility

    Task isolation and other application-specific concerns should be handled
    at the orchestration layer by passing appropriate collection_name and
    storage_path values.
    """

    agent_name: str = Agents.task_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        collection_name: str | None = None,
        storage_path: str | Path | None = None,
        storage_type: StorageType | None = None,
        embedding_model: BaseEmbedding | None = None,
        vector_dim: int | None = None,
    ):
        """Initialize RAGToolkit with configurable storage.

        Args:
            api_task_id (str): Task ID for eigent integration.
            agent_name (str | None): Optional agent name override.
            collection_name (str | None): Name for the vector collection.
            storage_path (str | Path | None): Path for vector storage.
            storage_type (StorageType | None): Vector storage type (default: QDRANT).
            embedding_model (BaseEmbedding | None): Custom embedding model.
            vector_dim (int | None): Embedding dimension (required if custom model).
        """
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name

        # Use provided paths or defaults
        self._storage_path = (
            Path(storage_path)
            if storage_path
            else Path(os.path.expanduser(DEFAULT_RAG_STORAGE_PATH))
        )
        self._storage_path.mkdir(parents=True, exist_ok=True)

        self._collection_name = collection_name or DEFAULT_COLLECTION_NAME
        self._storage_type = storage_type or DEFAULT_STORAGE_TYPE
        self._custom_embedding_model = embedding_model
        self._vector_dim = vector_dim or DEFAULT_EMBEDDING_DIM

        # Initialize CAMEL's AutoRetriever with configured storage
        auto_retriever = AutoRetriever(
            vector_storage_local_path=str(self._storage_path),
            storage_type=self._storage_type,
        )

        # Wrap CAMEL's RetrievalToolkit using composition (for file/URL retrieval)
        self._retrieval_toolkit = RetrievalToolkit(
            auto_retriever=auto_retriever
        )

        # Lazy-initialized components for raw text support
        self._embedding_model = None
        self._vector_retriever = None
        self._storage = None

    def _get_embedding_model(self):
        """Lazily initialize embedding model."""
        if self._embedding_model is None:
            if self._custom_embedding_model is not None:
                self._embedding_model = self._custom_embedding_model
            else:
                api_key = env("OPENAI_API_KEY")
                if not api_key:
                    raise ValueError(
                        "OPENAI_API_KEY required (or provide embedding_model)"
                    )
                self._embedding_model = OpenAIEmbedding(api_key=api_key)
        return self._embedding_model

    def _get_storage(self):
        """Lazily initialize vector storage for raw text."""
        if self._storage is None:
            self._storage = self._create_storage(
                vector_dim=self._vector_dim,
                path=str(self._storage_path / RAW_TEXT_SUBDIR),
                collection_name=self._collection_name,
            )
        return self._storage

    def _create_storage(
        self, vector_dim: int, path: str, collection_name: str
    ) -> BaseVectorStorage:
        """Create vector storage based on configured storage type."""
        if self._storage_type == StorageType.QDRANT:
            return QdrantStorage(
                vector_dim=vector_dim,
                path=path,
                collection_name=collection_name,
            )
        raise ValueError(f"Unsupported storage type: {self._storage_type}")

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
        contents: str | list[str],
        top_k: int = 5,
        similarity_threshold: float = 0.5,
    ) -> str:
        """Retrieves information from a local vector storage based on the query.

        This method connects to a task-isolated vector storage and retrieves
        relevant information. Content is automatically indexed on first use.

        Args:
            query (str): The question or query for which an answer is required.
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
            logger.info(
                f"Retrieved information for query in collection {self._collection_name}"
            )
            return result
        except Exception as e:
            logger.error(f"Failed to retrieve information: {e}", exc_info=True)
            return f"Error retrieving information: {str(e)}"

    def add_document(
        self,
        content: str,
        metadata: dict | None = None,
        doc_id: str | None = None,
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
                doc_id = hashlib.md5(  # noqa: S324
                    content.encode(), usedforsecurity=False
                ).hexdigest()[:12]

            # Prepare metadata
            doc_metadata = metadata or {}
            doc_metadata["doc_id"] = doc_id
            doc_metadata["collection"] = self._collection_name

            # Get vector retriever and add content
            retriever = self._get_vector_retriever()
            retriever.process(content=content, extra_info=doc_metadata)

            logger.info(
                f"Added document {doc_id} to collection {self._collection_name}"
            )
            return (
                f"Successfully added document (ID: {doc_id}) to knowledge base"
            )

        except Exception as e:
            logger.error(f"Failed to add document: {e}", exc_info=True)
            return f"Error adding document: {str(e)}"

    def query_knowledge_base(
        self,
        query: str,
        top_k: int = 5,
        similarity_threshold: float = 0.5,
    ) -> str:
        """Query the knowledge base for relevant information from added documents.

        This queries documents previously added via add_document().
        For querying files/URLs, use information_retrieval() instead.

        Args:
            query (str): The question or search query to find relevant documents.
            top_k (int): Maximum number of relevant chunks to return (default: 5).
            similarity_threshold (float): Minimum similarity score (default: 0.5).

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
            results = retriever.query(
                query=query,
                top_k=top_k,
                similarity_threshold=similarity_threshold,
            )

            # Format results as a simple numbered list
            formatted_results = []
            for i, result in enumerate(results, 1):
                text = result.get("text", result.get("content", ""))
                metadata = result.get("metadata", {})

                result_text = f"{i}. {text}"
                if metadata:
                    source = metadata.get("source", metadata.get("doc_id", ""))
                    if source:
                        result_text += f" (Source: {source})"
                formatted_results.append(result_text)

            if not formatted_results:
                return f"No relevant information found for query: {query}"

            logger.info(
                f"Retrieved {len(results)} results for query in collection {self._collection_name}"
            )
            return "\n\n".join(formatted_results)

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
            if self._storage_path.exists():
                for item in self._storage_path.iterdir():
                    if item.is_dir():
                        collections.append(item.name)

            if not collections:
                return "No knowledge bases found. Use add_document or information_retrieval to create one."

            return "Available knowledge bases:\n" + "\n".join(
                f"- {c}" for c in sorted(collections)
            )

        except Exception as e:
            logger.error(f"Failed to list knowledge bases: {e}", exc_info=True)
            return f"Error listing knowledge bases: {str(e)}"

    def get_tools(self) -> list[FunctionTool]:
        """Return the list of tools provided by this toolkit.

        Note: list_knowledge_bases is not exposed as a tool since with task
        isolation, each task has its own collection and listing all KBs
        is not useful for the agent.
        """
        return [
            FunctionTool(self.add_document),
            FunctionTool(self.query_knowledge_base),
            FunctionTool(self.information_retrieval),
        ]

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """Return tools that can be used based on available configuration.

        Args:
            api_task_id (str): Task ID for eigent integration.
        """
        # Auto-derive collection name for task isolation
        collection_name = f"task_{api_task_id}"
        toolkit = RAGToolkit(
            api_task_id=api_task_id,
            collection_name=collection_name,
        )
        return toolkit.get_tools()
