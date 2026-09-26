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

"""Translate known file arguments before checkpointing or permission checks."""

from pathlib import Path

from app.run_context import get_current_run_context


def private_workspace_path(value):
    context = get_current_run_context()
    if (
        not isinstance(value, str)
        or context is None
        or context.workspace_source_root is None
    ):
        return value
    path = Path(value)
    if not path.is_absolute():
        return value
    # Resolve dot segments, without following symlinks back into another root.
    import os

    path = Path(os.path.normpath(path))
    try:
        relative = path.relative_to(context.workspace_source_root)
    except ValueError:
        return value
    return str(context.working_directory / relative)


def private_tool_arguments(toolkit_name, function_name, arguments):
    # Do not rewrite file contents, shell code, URLs, or arbitrary connector
    # schemas. Only these code-owned adapters define these parameters as paths.
    fields = ()
    if toolkit_name in {"FileToolkit", "File Toolkit"}:
        fields = {
            "write_to_file": ("filename",),
            "edit_file": ("file_path",),
            "read_file": ("file_paths",),
            "search_files": ("path",),
            "glob_files": ("path",),
            "grep_files": ("path",),
        }.get(function_name, ())
    elif toolkit_name == "Browser Toolkit" and function_name.startswith(
        "browser_upload_file"
    ):
        fields = ("file_path",)
    result = dict(arguments)
    for field in fields:
        value = result.get(field)
        if isinstance(value, list):
            result[field] = [private_workspace_path(item) for item in value]
        elif field in result:
            result[field] = private_workspace_path(value)
    return result
