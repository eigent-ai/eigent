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

import threading

import pytest

from app.service.task import (
    _task_locks_mutex,
    create_task_lock,
    delete_task_lock,
    get_or_create_task_lock,
    task_locks,
)


@pytest.mark.unit
class TestTaskLockMutex:
    """Tests verifying the _task_locks_mutex protects task_locks from races."""

    def setup_method(self):
        """Clean up task_locks before each test."""
        with _task_locks_mutex:
            task_locks.clear()

    def teardown_method(self):
        """Clean up task_locks after each test."""
        with _task_locks_mutex:
            task_locks.clear()

    def test_create_task_lock_is_thread_safe(self):
        """Concurrent create_task_lock calls should not corrupt task_locks."""
        errors = []
        barrier = threading.Barrier(10)

        def worker(idx):
            try:
                barrier.wait(timeout=5)
                create_task_lock(f"task_{idx}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not errors, f"Unexpected errors: {errors}"
        with _task_locks_mutex:
            assert len(task_locks) == 10

    def test_get_or_create_is_idempotent(self):
        """get_or_create_task_lock called twice returns the same lock."""
        lock1 = get_or_create_task_lock("same_id")
        lock2 = get_or_create_task_lock("same_id")
        assert lock1 is lock2

    def test_create_task_lock_raises_on_duplicate(self):
        """create_task_lock should raise for an existing id."""
        create_task_lock("dup_id")
        with pytest.raises(Exception):
            create_task_lock("dup_id")

    def test_mutex_attribute_exists(self):
        """_task_locks_mutex should be a threading.Lock instance."""
        assert isinstance(_task_locks_mutex, type(threading.Lock()))
