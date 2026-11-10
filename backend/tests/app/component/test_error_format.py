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

"""Pin diagnostic envelopes used by the frontend error presentation fixtures."""

import importlib.util
from pathlib import Path

import pytest

# The formatter is pure. Loading it directly avoids starting the application or
# loading account configuration for a transport-format contract test.
_spec = importlib.util.spec_from_file_location(
    "quota_error_format",
    Path(__file__).parents[3] / "app/component/error_format.py",
)
_formatter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_formatter)


@pytest.mark.parametrize("status", [402, 403, 429])
def test_json_error_retains_code_and_nested_message(status):
    raw = (
        f'Error code: {status} - {{"error": {{"code": "{status}", '
        '"type": "trial_daily_exhausted", '
        '"message": {"reason": "trial_daily_exhausted", '
        '"request_id": "synthetic-request"}}}'
    )
    message, code, error = _formatter.normalize_error_to_openai_format(
        Exception(raw)
    )
    assert code == str(status)
    assert message == {
        "reason": "trial_daily_exhausted",
        "request_id": "synthetic-request",
    }
    assert error["type"] == "trial_daily_exhausted"


def test_python_budget_repr_remains_diagnostic_input_for_client():
    raw = (
        "Error code: 400 - {'error': {'message': 'Budget has been exceeded!', "
        "'type': 'budget_exceeded', 'param': None, 'code': '400'}}"
    )
    message, code, error = _formatter.normalize_error_to_openai_format(
        Exception(raw)
    )
    assert message == raw
    assert code == "400"
    assert error is None


def test_unknown_error_is_not_assigned_a_billing_reason():
    raw = "{'detail': {'unknown': 'synthetic-secret'}}"
    assert _formatter.normalize_error_to_openai_format(Exception(raw)) == (
        raw,
        None,
        None,
    )
