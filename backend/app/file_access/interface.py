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

from abc import ABC, abstractmethod


class IFileAccess(ABC):
    """File access abstraction, implementation selected by client type"""

    @abstractmethod
    def read_file(self, path: str) -> str:
        """Read file content, return text"""
        pass

    @abstractmethod
    def read_file_binary(self, path: str) -> bytes:
        """Read file as binary"""
        pass

    @abstractmethod
    def write_file(self, path: str, content: str | bytes) -> None:
        """Write file"""
        pass

    @abstractmethod
    def exists(self, path: str) -> bool:
        """Check if path exists"""
        pass

    @abstractmethod
    def list_dir(self, path: str) -> list[str]:
        """List directory contents"""
        pass

    @abstractmethod
    def get_working_directory(self, session_id: str) -> str:
        """Return session working directory absolute path"""
        pass

    @abstractmethod
    def resolve_path(self, path_or_id: str, session_id: str) -> str:
        """Resolve path or file_id to actual path"""
        pass
