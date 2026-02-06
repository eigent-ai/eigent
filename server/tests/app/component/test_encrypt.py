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

import pytest

from app.component.encrypt import password_hash, password_verify


def test_password_hash_returns_hashed_string():
    result = password_hash("test_password")
    assert isinstance(result, str)
    assert len(result) > 0


def test_password_hash_differs_from_plaintext():
    plaintext = "my_secret_password"
    hashed = password_hash(plaintext)
    assert hashed != plaintext


def test_password_hash_same_password_produces_different_hashes():
    password = "same_password"
    hash1 = password_hash(password)
    hash2 = password_hash(password)
    assert hash1 != hash2


def test_password_hash_starts_with_bcrypt_identifier():
    hashed = password_hash("test")
    assert hashed.startswith("$2b$")


def test_password_hash_empty_password_can_be_hashed():
    hashed = password_hash("")
    assert isinstance(hashed, str)
    assert len(hashed) > 0


def test_password_verify_correct_password_returns_true():
    password = "correct_password"
    hashed = password_hash(password)
    assert password_verify(password, hashed) is True


def test_password_verify_incorrect_password_returns_false():
    hashed = password_hash("original_password")
    assert password_verify("wrong_password", hashed) is False


def test_password_verify_none_hash_returns_false():
    assert password_verify("any_password", None) is False


def test_password_verify_empty_string_hash_raises():
    with pytest.raises(Exception):
        password_verify("password", "")


def test_password_verify_case_sensitive():
    hashed = password_hash("Password123")
    assert password_verify("Password123", hashed) is True
    assert password_verify("password123", hashed) is False
    assert password_verify("PASSWORD123", hashed) is False


def test_password_verify_special_characters():
    special_password = "p@$$w0rd!#%^&*()"
    hashed = password_hash(special_password)
    assert password_verify(special_password, hashed) is True


def test_password_verify_unicode():
    unicode_password = "密码🔐パスワード"
    hashed = password_hash(unicode_password)
    assert password_verify(unicode_password, hashed) is True


def test_password_verify_very_long_password():
    long_password = "a" * 100
    hashed = password_hash(long_password)
    assert password_verify(long_password, hashed) is True
