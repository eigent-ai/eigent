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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from camel.societies.workforce.single_agent_worker import (
    SingleAgentWorker as BaseSingleAgentWorker,
)
from camel.tasks.task import TaskState

from app.agent.listen_chat_agent import ListenChatAgent
from app.utils.single_agent_worker import SingleAgentWorker


@pytest.mark.unit
class TestSingleAgentWorker:
    """Test cases for SingleAgentWorker class."""

    def test_initialization(self):
        """Test SingleAgentWorker initialization."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        mock_worker.agent_name = "test_worker"

        worker = SingleAgentWorker(
            description="Test worker description",
            worker=mock_worker,
            use_agent_pool=True,
            pool_initial_size=2,
            pool_max_size=5,
        )

        assert worker.worker is mock_worker
        assert worker.use_agent_pool is True
        assert worker.agent_pool is not None

    def test_inherits_from_base_class(self):
        """Test that SingleAgentWorker inherits from BaseSingleAgentWorker."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "test_agent_123"
        mock_worker.agent_name = "test_worker"
        worker = SingleAgentWorker(description="Test", worker=mock_worker)

        assert isinstance(worker, BaseSingleAgentWorker)

    @pytest.mark.asyncio
    async def test_get_worker_agent_injects_process_task_id(self):
        """Test that _get_worker_agent sets process_task_id on the agent."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        mock_worker.agent_name = "test_worker"

        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
        )

        mock_agent = MagicMock(spec=ListenChatAgent)
        mock_agent.agent_id = "pooled_agent_1"
        mock_agent.process_task_id = ""

        with patch.object(
            BaseSingleAgentWorker,
            "_get_worker_agent",
            new_callable=AsyncMock,
            return_value=mock_agent,
        ):
            worker._current_task_id = "task-42"
            agent = await worker._get_worker_agent()

            assert agent.process_task_id == "task-42"
            assert agent is mock_agent

    @pytest.mark.asyncio
    async def test_process_task_delegates_to_base(self):
        """Test that _process_task delegates to base class."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        mock_worker.agent_name = "test_worker"

        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
        )

        from camel.tasks.task import Task

        task = Task(content="Test task", id="task-1")

        with patch.object(
            BaseSingleAgentWorker,
            "_process_task",
            new_callable=AsyncMock,
            return_value=TaskState.DONE,
        ) as mock_base_process:
            result = await worker._process_task(task, [])

            assert result == TaskState.DONE
            mock_base_process.assert_called_once_with(task, [], None)
            # _current_task_id should be cleaned up
            assert worker._current_task_id is None

    @pytest.mark.asyncio
    async def test_process_task_cleans_up_on_failure(self):
        """Test that _current_task_id is cleaned up even on failure."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        mock_worker.agent_name = "test_worker"

        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
        )

        from camel.tasks.task import Task

        task = Task(content="Test task", id="task-1")

        with (
            patch.object(
                BaseSingleAgentWorker,
                "_process_task",
                new_callable=AsyncMock,
                side_effect=RuntimeError("boom"),
            ),
            pytest.raises(RuntimeError, match="boom"),
        ):
            await worker._process_task(task, [])

        assert worker._current_task_id is None
