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
 * BottomBox input-variant system.
 *
 * The BottomBox is a shell (queued messages, usage banner, model overlay). What
 * it renders *inside* is chosen by a variant, resolved from the current input
 * context — today driven by the type of ask the model sent, and open to other
 * signals (e.g. the page/route) later.
 *
 * Adding a new input affordance = add a `BottomBoxVariantKind`, a matcher in
 * `registry.ts`, and a render branch in `BottomBox/index.tsx`. No giant switch.
 */

import type { AskInputDescriptor } from '../../ask/askPayload';

export type BottomBoxVariantKind =
  /** Free-text composer + plan confirm/save headers (today's default). */
  | 'default'
  /** Question + vertically-stacked option buttons / follow-up form. */
  | 'question';

/** Signals a variant can match on. Extend as new variant triggers appear. */
export interface BottomBoxVariantContext {
  /** Active structured ask awaiting an answer, or null. */
  ask: AskInputDescriptor | null;
}

export interface BottomBoxVariantDef {
  kind: BottomBoxVariantKind;
  /** First matching def (in registry order) wins. */
  match: (ctx: BottomBoxVariantContext) => boolean;
}
