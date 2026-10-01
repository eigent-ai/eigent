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

"""Fresh blocking authority checks whose threads cannot outlive their caller."""

import asyncio


async def run_authorization_check(function, /, *args):
    # Keep the concrete worker through repeated cancellation. A cancelled
    # to_thread waiter alone does not prove that its journal reader has stopped.
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    cancelled = None
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError as error:
            cancelled = error
        except BaseException:
            break  # Retrieve the worker's outcome below, including exceptions.
    try:
        result = task.result()
    finally:
        if cancelled is not None:
            raise cancelled
    return result
