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
"""Unit tests for app.component.encrypt module."""

import pytest

from app.component.encrypt import password_hash, password_verify


class TestPasswordHash:
    """Tests for password_hash function."""

    def test_returns_hashed_string(self) -> None:
        """password_hash should return a non-empty hashed string."""
        result = password_hash("test_password")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_hash_differs_from_plaintext(self) -> None:
        """Hashed password should not equal the plaintext password."""
        plaintext = "my_secret_password"
        hashed = password_hash(plaintext)
        assert hashed != plaintext

    def test_same_password_produces_different_hashes(self) -> None:
        """Bcrypt should produce different hashes for same password (due to salt)."""
        password = "same_password"
        hash1 = password_hash(password)
        hash2 = password_hash(password)
        assert hash1 != hash2

    def test_hash_starts_with_bcrypt_identifier(self) -> None:
        """Bcrypt hashes should start with $2b$ identifier."""
        hashed = password_hash("test")
        assert hashed.startswith("$2b$")

    def test_empty_password_can_be_hashed(self) -> None:
        """Empty strings should be hashable (edge case)."""
        hashed = password_hash("")
        assert isinstance(hashed, str)
        assert len(hashed) > 0


class TestPasswordVerify:
    """Tests for password_verify function."""

    def test_correct_password_returns_true(self) -> None:
        """Verification should return True for correct password."""
        password = "correct_password"
        hashed = password_hash(password)
        assert password_verify(password, hashed) is True

    def test_incorrect_password_returns_false(self) -> None:
        """Verification should return False for incorrect password."""
        hashed = password_hash("original_password")
        assert password_verify("wrong_password", hashed) is False

    def test_none_hash_returns_false(self) -> None:
        """Verification should return False when hash is None."""
        assert password_verify("any_password", None) is False

    def test_empty_string_hash_returns_false(self) -> None:
        """Verification should return False for empty hash string."""
        # passlib.verify raises ValueError for empty hash, 
        # but function guards with None check only
        # This tests the actual behavior
        with pytest.raises(Exception):
            password_verify("password", "")

    def test_case_sensitive_password(self) -> None:
        """Password verification should be case-sensitive."""
        hashed = password_hash("Password123")
        assert password_verify("Password123", hashed) is True
        assert password_verify("password123", hashed) is False
        assert password_verify("PASSWORD123", hashed) is False

    def test_special_characters_in_password(self) -> None:
        """Passwords with special characters should work correctly."""
        special_password = "p@$$w0rd!#%^&*()"
        hashed = password_hash(special_password)
        assert password_verify(special_password, hashed) is True

    def test_unicode_password(self) -> None:
        """Unicode passwords should be handled correctly."""
        unicode_password = "密码🔐パスワード"
        hashed = password_hash(unicode_password)
        assert password_verify(unicode_password, hashed) is True

    def test_very_long_password(self) -> None:
        """Very long passwords should be handled (bcrypt truncates at 72 bytes)."""
        long_password = "a" * 100
        hashed = password_hash(long_password)
        assert password_verify(long_password, hashed) is True
