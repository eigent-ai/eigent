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

import { InputSelect } from '@/components/ui/input-select';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const options = [
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
];

function renderSelect(value: string) {
  const onChange = vi.fn();
  render(<InputSelect value={value} onChange={onChange} options={options} />);
  return { onChange, input: screen.getByRole('textbox') };
}

// Blur commits after a short delay so option clicks can run first.
const settleBlur = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 200)));

describe('InputSelect commit', () => {
  it('keeps the selected value when the shown label is left unchanged', async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderSelect('1');
    expect(input).toHaveValue('1st');

    await user.click(input);
    await user.tab();
    await settleBlur();

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('1st');
  });

  it("commits an option's value when its label is typed", async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderSelect('1');

    await user.clear(input);
    await user.type(input, '2nd{Enter}');

    expect(onChange).toHaveBeenCalledWith('2');
    expect(onChange).not.toHaveBeenCalledWith('2nd');
  });

  it('commits other typed text as entered', async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderSelect('1');

    await user.clear(input);
    await user.type(input, '7{Enter}');

    expect(onChange).toHaveBeenCalledWith('7');
  });
});
