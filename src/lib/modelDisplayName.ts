// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

/**
 * The name to show for a model id. OpenAI-compatible gateways, including
 * Eigent Cloud's, address a model as `provider/model` (`openai/gemini-x`);
 * people choose the model, so only the part after the last `/` is shown.
 * The full id stays the model's identity everywhere else.
 */
export function modelDisplayName(modelType: string | null | undefined): string {
  const id = (modelType ?? '').trim();
  const name = id.slice(id.lastIndexOf('/') + 1).trim();
  return name || id;
}

/**
 * The name of a saved model among the others from the same provider. When
 * two of them would show the same name (`openai/gpt-5` and `azure/gpt-5`
 * through one gateway), both keep their full id so they stay distinct.
 */
export function configuredModelName(
  record: { id: string | number; provider_name: string; model_type: string },
  records: readonly {
    id: string | number;
    provider_name: string;
    model_type: string;
  }[]
): string {
  const name = modelDisplayName(record.model_type);
  const ambiguous = records.some(
    (other) =>
      other.id !== record.id &&
      other.provider_name === record.provider_name &&
      other.model_type !== record.model_type &&
      modelDisplayName(other.model_type) === name
  );
  return ambiguous ? record.model_type : name;
}
