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

import type { FixedTone, Mode } from './types';

export type FixedToneSeed = {
  // Base tone color for text/icon and derived border/bg states.
  color: `#${string}`;
  // Optional explicit selected background. Falls back to derived value when omitted.
  selectedBg?: string;
};

export type FixedToneSchema = Record<Mode, Record<FixedTone, FixedToneSeed>>;

// Developer-owned fixed tones. Not user-editable through theme import/customization UI.
export const DEFAULT_FIXED_TONE_SCHEMA: FixedToneSchema = {
  light: {
    'single-agent': {
      color: '#7e22ce',
      selectedBg: '#f3e8ff',
    },
    workforce: {
      color: '#007a55',
      selectedBg: '#d0fae5',
    },
    browser: {
      color: '#0084d1',
    },
    terminal: {
      color: '#009966',
    },
    document: {
      color: '#e17100',
    },
    success: {
      color: '#00a63e',
    },
    caution: {
      color: '#e7000b',
    },
    error: {
      color: '#e7000b',
    },
    warning: {
      color: '#d08700',
    },
    information: {
      color: '#155dfc',
    },
  },
  dark: {
    'single-agent': {
      color: '#e9d5ff',
      selectedBg: 'rgba(168, 85, 247, 0.22)',
    },
    workforce: {
      color: '#6ee7b7',
      selectedBg: 'rgba(52, 211, 153, 0.2)',
    },
    browser: {
      color: '#7dd3fc',
    },
    terminal: {
      color: '#6ee7b7',
    },
    document: {
      color: '#ffd479',
    },
    success: {
      color: '#4ade80',
    },
    caution: {
      color: '#f87171',
    },
    error: {
      color: '#f87171',
    },
    warning: {
      color: '#facc15',
    },
    information: {
      color: '#7ab3ff',
    },
  },
};
