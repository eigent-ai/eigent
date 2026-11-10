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

/** Unknown execution requires the same explicit decision as active execution. */
export async function confirmNativeQuit({
  lookup,
  confirm,
}: {
  lookup: () => Promise<unknown>;
  confirm: (unknown: boolean) => Promise<boolean>;
}): Promise<boolean> {
  let active: boolean | undefined;
  try {
    const response = await lookup();
    const value = (response as { active?: unknown } | null)?.active;
    if (typeof value === 'boolean') active = value;
  } catch {
    // The dialog explains that the running-task state could not be checked.
  }
  if (active === false) return true;
  return confirm(active === undefined);
}
