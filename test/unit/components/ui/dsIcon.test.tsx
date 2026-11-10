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

import { DsIcon, type DsIconProps } from '@/components/ui/ds-icon';
import { render } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

function renderIcon(props: Omit<DsIconProps, 'icon'> = {}) {
  const { container } = render(<DsIcon icon={Search} {...props} />);
  return container.querySelector('svg')!;
}

/** Lucide draws in a 24-unit box; this is the stroke as it appears on screen. */
function screenStroke(svg: SVGSVGElement) {
  const size = Number(svg.getAttribute('width'));
  return (Number(svg.getAttribute('stroke-width')) * size) / 24;
}

describe('DsIcon', () => {
  it('renders the standard 16px style with a 1.25px stroke on screen', () => {
    const svg = renderIcon();
    expect(svg.getAttribute('width')).toBe('16');
    expect(screenStroke(svg)).toBeCloseTo(1.25);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the same 1.25px stroke for the 12px compact style', () => {
    const svg = renderIcon({ recipe: 'main-compact' });
    expect(svg.getAttribute('width')).toBe('12');
    expect(screenStroke(svg)).toBeCloseTo(1.25);
  });

  it('draws illustrations at their size with a 1.5px stroke', () => {
    const svg = renderIcon({ recipe: 'illustration', illustrationSize: 40 });
    expect(svg.getAttribute('width')).toBe('40');
    expect(screenStroke(svg)).toBeCloseTo(1.5);
  });

  it('exposes a meaningful icon to assistive technology when asked', () => {
    const svg = renderIcon({ decorative: false, 'aria-label': 'Search' });
    expect(svg).not.toHaveAttribute('aria-hidden');
    expect(svg).toHaveAttribute('aria-label', 'Search');
  });
});
