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

/** The parts of Monaco's `ILineChange` the counters need. */
export interface DiffLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export interface LineCounts {
  added: number;
  removed: number;
}

/**
 * Ceiling on the edit distance the standalone counter will explore. Myers runs
 * in O(N·D), so a pathological pair (two unrelated files of thousands of lines)
 * is bounded rather than allowed to lock the renderer. Past it the file's
 * counts are reported as unknown instead of guessed at.
 */
const MAX_EDIT_DISTANCE = 5000;

/** Content lines, ignoring the trailing newline most files end with. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r?\n$/, '').split('\n');
}

/**
 * Length of the shortest edit script between two line arrays (Myers' greedy
 * algorithm), or null when it exceeds `maxDistance`.
 */
function editDistance(
  a: readonly string[],
  b: readonly string[],
  maxDistance: number
): number | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(maxDistance, n + m);
  // +3 so the k-1 / k+1 probes at the diagonal edges stay in bounds.
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      const goDown =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = goDown ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return d;
    }
  }
  return null;
}

/**
 * Added/removed line counts for two versions of a file, computed without an
 * editor. The review header needs a total across every changed file, including
 * the ones the user has not scrolled to yet, so it cannot source counts from
 * the Monaco instances the cards mount lazily.
 *
 * Returns null when the pair is too dissimilar to diff within the budget.
 */
export function countLineDiff(
  original: string,
  modified: string
): LineCounts | null {
  const before = splitLines(original);
  const after = splitLines(modified);

  // Identical head and tail can never be part of an edit; trimming them keeps
  // the search proportional to the change, not to the size of the file.
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  const a = before.slice(start, before.length - end);
  const b = after.slice(start, after.length - end);

  const distance = editDistance(a, b, MAX_EDIT_DISTANCE);
  if (distance === null) return null;
  // Every edit is one insertion or one deletion, so the two counts are fixed
  // by the distance and the length difference.
  const delta = b.length - a.length;
  return { added: (distance + delta) / 2, removed: (distance - delta) / 2 };
}

/**
 * Added/removed line counts for a diff.
 *
 * A text model always holds at least one line, so an empty side is really one
 * empty line: Monaco reports the first line of an added file as replacing that
 * phantom line, which used to read as "−1" on every new file. Whenever a side
 * has no content at all, its counter is zero — nothing was there to remove
 * (added file) and nothing is left to add (deleted file).
 */
export function countLineChanges(
  changes: readonly DiffLineChange[] | null | undefined,
  { originalEmpty = false, modifiedEmpty = false } = {}
): LineCounts {
  if (!changes) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    // Monaco marks a pure insertion/deletion with an end line of 0.
    if (
      !modifiedEmpty &&
      change.modifiedEndLineNumber >= change.modifiedStartLineNumber
    )
      added +=
        change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
    if (
      !originalEmpty &&
      change.originalEndLineNumber >= change.originalStartLineNumber
    )
      removed +=
        change.originalEndLineNumber - change.originalStartLineNumber + 1;
  }
  return { added, removed };
}
