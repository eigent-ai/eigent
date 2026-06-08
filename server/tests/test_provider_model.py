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

from app.model.provider.provider import ProviderIn, VaildStatus


def test_provider_in_accepts_is_valid_alias():
    provider = ProviderIn(
        provider_name="aws-bedrock-converse",
        model_type="anthropic.claude-3-5-sonnet",
        api_key="",
        endpoint_url="https://bedrock-runtime.us-east-1.amazonaws.com",
        is_valid=True,
    )

    assert provider.is_vaild == VaildStatus.is_valid


def test_provider_in_preserves_is_vaild_field():
    provider = ProviderIn(
        provider_name="aws-bedrock-converse",
        model_type="anthropic.claude-3-5-sonnet",
        api_key="",
        endpoint_url="https://bedrock-runtime.us-east-1.amazonaws.com",
        is_vaild=VaildStatus.not_valid,
    )

    assert provider.is_vaild == VaildStatus.not_valid
