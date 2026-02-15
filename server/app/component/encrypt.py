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

from passlib.context import CryptContext

password = CryptContext(schemes=["bcrypt"], deprecated="auto")


def password_hash(password_value: str):
    return password.hash(password_value)


def password_verify(password_value: str, password_hash: str | None):
    if not password_hash:
        return False
    return password.verify(password_value, password_hash)
