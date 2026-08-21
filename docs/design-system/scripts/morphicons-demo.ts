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
// Licensed under the Apache License, Version 2.0.

import {
  Check as checkIcon,
  ChevronDown as chevronDownIcon,
  ChevronRight as chevronRightIcon,
  Pause as pauseIcon,
  Play as playIcon,
  Send as sendIcon,
} from 'lucide';
import { createMorph, type Morph } from 'morphicons/dom';

const pairs = {
  'play-pause': {
    from: playIcon,
    to: pauseIcon,
    fromLabel: 'Play',
    toLabel: 'Pause',
  },
  'send-check': {
    from: sendIcon,
    to: checkIcon,
    fromLabel: 'Send',
    toLabel: 'Sent',
  },
  'chevron-expand': {
    from: chevronRightIcon,
    to: chevronDownIcon,
    fromLabel: 'Expand',
    toLabel: 'Collapse',
  },
} as const;

type MorphPairName = keyof typeof pairs;

document
  .querySelectorAll<HTMLButtonElement>('[data-morph-demo]')
  .forEach((button) => {
    const pairName = button.dataset.morphDemo as MorphPairName | undefined;
    const path = button.querySelector<SVGPathElement>('[data-morph-path]');
    const label = button.querySelector<HTMLElement>('[data-morph-label]');
    const pair = pairName ? pairs[pairName] : undefined;

    if (!pair || !path || !label) return;

    let active = false;
    const morph: Morph = createMorph(path, pair.from, {
      reducedMotion: 'user',
    });

    const updateState = () => {
      const nextLabel = active ? pair.toLabel : pair.fromLabel;
      label.textContent = nextLabel;
      button.setAttribute('aria-label', nextLabel);
      button.setAttribute('aria-pressed', String(active));
      if (pairName === 'chevron-expand') {
        button.setAttribute('aria-expanded', String(active));
      }
    };

    button.addEventListener('click', () => {
      active = !active;
      morph.morphTo(active ? pair.to : pair.from, 'snappy');
      updateState();
    });

    updateState();
  });
