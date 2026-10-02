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

// The profile step follows Language. Continue requires a role; Skip stores
// Others so later surfaces always have a profile to read.

import { OnboardingSteps } from '@/components/InstallStep/OnboardingSteps';
import { useAuthStore } from '@/store/authStore';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const eventMocks = vi.hoisted(() => ({
  recordOnboardingStepCompleted: vi.fn(),
}));

vi.mock('@/lib/events/appEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/events/appEvents')>()),
  recordOnboardingStepCompleted: eventMocks.recordOnboardingStepCompleted,
}));

async function openProfileStep() {
  const user = userEvent.setup();
  render(<OnboardingSteps onComplete={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByRole('heading', { name: 'Choose your role' });
  return user;
}

describe('OnboardingSteps profile step', () => {
  beforeEach(() => {
    eventMocks.recordOnboardingStepCompleted.mockClear();
    useAuthStore.setState({ workProfile: 'others' });
  });

  it('requires a role before Continue and stores the selection', async () => {
    const user = await openProfileStep();
    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();

    const role = screen.getByRole('button', { name: 'Scientist' });
    expect(role.querySelector('svg')).toBeNull();
    await user.click(role);

    expect(role).toHaveAttribute('aria-pressed', 'true');
    expect(useAuthStore.getState().workProfile).toBe('scientist');
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);
    expect(eventMocks.recordOnboardingStepCompleted).toHaveBeenLastCalledWith({
      step_id: 2,
      step_name: 'profile',
    });
    expect(
      await screen.findByText('Choose your appearance')
    ).toBeInTheDocument();
  });

  it('allows Others as an explicit choice', async () => {
    const user = await openProfileStep();
    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Others' }));

    expect(useAuthStore.getState().workProfile).toBe('others');
    expect(continueButton).toBeEnabled();
  });

  it('falls back to Others when the step is skipped', async () => {
    const user = await openProfileStep();
    await user.click(screen.getByRole('button', { name: 'Marketing' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(useAuthStore.getState().workProfile).toBe('others');
    expect(eventMocks.recordOnboardingStepCompleted).toHaveBeenLastCalledWith({
      step_id: 2,
      step_name: 'profile',
      phase: 'skipped',
    });
    expect(
      await screen.findByText('Choose your appearance')
    ).toBeInTheDocument();
  });
});
