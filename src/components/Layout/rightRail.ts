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

/** Shared responsive width for fixed right-side content rails. */
export const RIGHT_RAIL_CONTENT_WIDTH_CLASS =
  'w-[min(360px,40vw)] max-w-[400px]';

/** Expanded outer rail width; matches its content without an extra clip. */
export const RIGHT_RAIL_EXPANDED_OUTER_CLASS = RIGHT_RAIL_CONTENT_WIDTH_CLASS;

/** Folded outer rail width; full-width content can remain mounted and clipped. */
export const RIGHT_RAIL_FOLDED_OUTER_CLASS = 'w-[40px]';
