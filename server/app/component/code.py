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

success = 0  # success response code
error = 1  # common error response code
not_found = 4  # can't find route or data

password = 10  # account or password error
token_need = 11
token_expired = 12
token_invalid = 13
token_blocked = 14

form_error = 100  # form pydantic validate error

no_permission_error = 300  # admin no permission error
