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

import os
import tempfile
from pathlib import Path

import pytest
from app.component.environment import env_base_dir, sanitize_env_path


def test_none_input_returns_none():
    """Test that None input returns None."""
    assert sanitize_env_path(None) is None


def test_empty_string_returns_none():
    """Test that empty string returns None."""
    assert sanitize_env_path("") is None


def test_valid_relative_path():
    """Test that valid relative path within base dir is accepted."""
    result = sanitize_env_path("project1.env")
    assert result is not None
    assert result.startswith(env_base_dir)
    assert result.endswith("project1.env")


def test_valid_absolute_path_within_base_dir():
    """Test that absolute path within base directory is accepted."""
    valid_path = os.path.join(env_base_dir, "valid.env")
    result = sanitize_env_path(valid_path)
    assert result == os.path.abspath(valid_path)


def test_path_traversal_attack_rejected():
    """Test that path traversal attempts are rejected."""
    malicious_paths = [
        "../../../etc/passwd",
        "../../.ssh/id_rsa.env",
        "../outside.env",
        "subdir/../../outside.env",
    ]
    for path in malicious_paths:
        result = sanitize_env_path(path)
        # Path traversal should either be rejected
        # or normalized within base_dir
        if result:
            assert result.startswith(env_base_dir), \
                f"Path traversal not blocked: {path} -> {result}"


def test_absolute_path_outside_base_dir_rejected():
    """Test that absolute paths outside base directory are rejected."""
    malicious_paths = [
        "/etc/passwd",
        "/tmp/evil.env",
        "/root/.env",
        str(Path.home() / "evil.env"),
    ]
    for path in malicious_paths:
        result = sanitize_env_path(path)
        assert result is None, \
            f"Absolute path outside base dir not rejected: {path}"


def test_non_env_extension_rejected():
    """Test that files without .env extension are rejected."""
    invalid_paths = [
        "config.txt",
        "settings.json",
        "environment",
        ".bashrc",
        "script.py",
    ]
    for path in invalid_paths:
        result = sanitize_env_path(path)
        assert result is None, \
            f"Non-.env file not rejected: {path}"


def test_nested_valid_path():
    """Test that valid nested paths within base dir are accepted."""
    result = sanitize_env_path("projects/project1/config.env")
    assert result is not None
    assert result.startswith(env_base_dir)
    assert result.endswith("config.env")


def test_symlink_escape_attempt():
    """Test that symlinks cannot be used to escape base directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create a symlink pointing outside base_dir
        link_path = os.path.join(env_base_dir, "evil_link.env")
        target_path = os.path.join(tmpdir, "outside.env")

        # This test only makes sense if we can create symlinks
        try:
            if os.path.exists(link_path):
                os.unlink(link_path)
            os.symlink(target_path, link_path)

            # The sanitized path should resolve the symlink
            result = sanitize_env_path("evil_link.env")

            # Either rejected or stays within base_dir after resolution
            if result:
                resolved = Path(result).resolve()
                base_resolved = Path(env_base_dir).resolve()
                # Check if resolved path is under base directory
                try:
                    resolved.relative_to(base_resolved)
                    # If this succeeds, symlink stayed in base (acceptable)
                except ValueError:
                    # Symlink escaped - should have been rejected
                    pytest.fail(f"Symlink escape not prevented: {result}")
        except (OSError, NotImplementedError):
            # Symlinks not supported on this system, skip test
            pytest.skip("Symlinks not supported")
        finally:
            # Cleanup
            if os.path.exists(link_path):
                os.unlink(link_path)


def test_dot_env_in_filename():
    """Test that .env can appear in the middle of filename."""
    result = sanitize_env_path("project.env.backup.env")
    assert result is not None
    assert result.endswith(".env")


def test_case_sensitivity():
    """Test handling of different case extensions."""
    # Only .env (lowercase) should be accepted
    assert sanitize_env_path("config.ENV") is None
    assert sanitize_env_path("config.Env") is None
    assert sanitize_env_path("config.env") is not None


def test_special_characters_in_path():
    """Test handling of special characters in valid paths."""
    # These should be accepted if they end with .env and stay in base_dir
    valid_special_chars = [
        "my-project.env",
        "project_name.env",
        "project.2024.env",
    ]
    for path in valid_special_chars:
        result = sanitize_env_path(path)
        assert result is not None, (f"Valid path with special "
                                    f"chars rejected: {path}")
        assert result.startswith(env_base_dir)


def test_whitespace_handling():
    """Test handling of whitespace in paths."""
    # Whitespace should be preserved in valid paths
    result = sanitize_env_path("my project.env")
    assert result is not None
    assert "my project.env" in result


def test_current_directory_traversal():
    """Test that ./ and current directory references are handled."""
    result = sanitize_env_path("./project.env")
    assert result is not None
    assert result.startswith(env_base_dir)

    result = sanitize_env_path("././project.env")
    assert result is not None
    assert result.startswith(env_base_dir)
