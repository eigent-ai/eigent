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

export const TEACH_MODE_ENABLED_CHANNEL = 'teach-mode-enabled';
export const TEACH_ANNOTATION_REQUEST_CHANNEL = 'teach-annotation-request';

export interface TeachAnnotationRequest {
  action: 'quick' | 'annotate';
  surfaceKind: 'main-renderer' | 'preview-guest';
  selectionText: string;
  pageUrl?: string;
  x?: number;
  y?: number;
}

export function isTeachAnnotationRequest(
  value: unknown
): value is TeachAnnotationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<TeachAnnotationRequest>;
  return (
    (request.action === 'quick' || request.action === 'annotate') &&
    (request.surfaceKind === 'main-renderer' ||
      request.surfaceKind === 'preview-guest') &&
    typeof request.selectionText === 'string' &&
    request.selectionText.length <= 10000 &&
    (request.pageUrl === undefined || typeof request.pageUrl === 'string') &&
    (request.x === undefined || Number.isFinite(request.x)) &&
    (request.y === undefined || Number.isFinite(request.y))
  );
}
