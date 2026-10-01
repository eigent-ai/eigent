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

"""Immutable reads reject special files without waiting for a FIFO writer."""

import multiprocessing
import os
from pathlib import Path

import pytest

from app.workspace_runtime.content import ContentIntegrityError, ContentStore


@pytest.mark.skipif(os.name != "posix", reason="requires real POSIX FIFO")
@pytest.mark.parametrize("replace_during_open", [False, True])
def test_content_fifo_returns_typed_error_without_a_writer(
    tmp_path, replace_during_open
):
    store = ContentStore(tmp_path / "objects")
    revision = store.put_blob(b"immutable")
    path = store._path("objects", revision)

    def read():
        if replace_during_open:
            original = os.open
            replaced = False

            def swap_then_open(file, flags, *args, **kwargs):
                nonlocal replaced
                if not replaced and Path(file) == path:
                    path.unlink()
                    os.mkfifo(path)
                    replaced = True
                return original(file, flags, *args, **kwargs)

            os.open = swap_then_open
        else:
            path.unlink()
            os.mkfifo(path)
        with pytest.raises(ContentIntegrityError, match="not a regular file"):
            store.read_blob(revision)

    process = multiprocessing.get_context("fork").Process(target=read)
    process.start()
    try:
        process.join(timeout=5)
        assert not process.is_alive(), "content read waited for a FIFO writer"
        assert process.exitcode == 0
    finally:
        if process.is_alive():
            process.kill()
            process.join(timeout=5)
