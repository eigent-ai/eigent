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

export type SpaceModelIdentity =
  | { category: 'cloud'; modelId: string }
  | { category: 'custom' | 'local'; platform: string; modelId: string };

export const spaceModelReference = (identity: SpaceModelIdentity): string =>
  `provider://${identity.category}/${identity.category === 'cloud' ? '' : `${encodeURIComponent(identity.platform)}/`}${encodeURIComponent(identity.modelId)}`;

export function parseSpaceModelReference(
  ref: string
): SpaceModelIdentity | null {
  try {
    const parts = ref
      .replace(/^provider:\/\//, '')
      .split('/')
      .map(decodeURIComponent);
    const [category, platformOrModel, modelId] = parts;
    const identity: SpaceModelIdentity | null =
      category === 'cloud' && parts.length === 2
        ? { category, modelId: platformOrModel }
        : (category === 'custom' || category === 'local') &&
            parts.length === 3 &&
            /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(platformOrModel)
          ? { category, platform: platformOrModel, modelId }
          : null;
    return identity &&
      identity.modelId.length <= 512 &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(identity.modelId) &&
      spaceModelReference(identity) === ref
      ? identity
      : null;
  } catch {
    return null;
  }
}
