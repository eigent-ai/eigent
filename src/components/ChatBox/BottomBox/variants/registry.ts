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

import type {
  BottomBoxVariantContext,
  BottomBoxVariantDef,
  BottomBoxVariantKind,
} from './types';

/**
 * Ordered variant table — the first matching def wins. Order = priority, so
 * specific matchers go above the catch-all `default`.
 */
const VARIANT_DEFS: BottomBoxVariantDef[] = [
  {
    // Any active ask (including plain-text) surfaces the question variant so
    // the user always sees the question and a dedicated reply control.
    kind: 'question',
    match: (ctx) => !!ctx.ask,
  },
  {
    kind: 'default',
    match: () => true,
  },
];

/** Resolve which BottomBox variant to render for the current input context. */
export function resolveBottomBoxVariant(
  ctx: BottomBoxVariantContext
): BottomBoxVariantKind {
  const def =
    VARIANT_DEFS.find((d) => d.match(ctx)) ??
    VARIANT_DEFS[VARIANT_DEFS.length - 1]!;
  return def.kind;
}
