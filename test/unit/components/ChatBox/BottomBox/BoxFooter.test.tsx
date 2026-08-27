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

import { BoxFooter } from '@/components/ChatBox/BottomBox/BoxFooter';
import { useProjectStore } from '@/store/projectStore';
import { SessionMode, ThinkingEffort } from '@/types/constants';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Workspace/ProjectModeToggle', () => ({
  ProjectModeToggle: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-testid="session-mode-toggle"
      data-readonly={String(Boolean(readOnly))}
    />
  ),
}));

vi.mock('@/components/ChatBox/BottomBox/ApprovalModeSelect', () => ({
  ApprovalModeSelect: () => <div data-testid="approval-mode-select" />,
}));

vi.mock('@/components/ChatBox/BottomBox/ModelAndThinkingEffortSelect', () => ({
  ModelAndThinkingEffortSelect: ({
    thinkingEffort,
    onThinkingEffortChange,
    disabled,
    readOnly,
    projectId,
  }: {
    thinkingEffort?: string;
    onThinkingEffortChange?: (effort: string | undefined) => void;
    disabled?: boolean;
    readOnly?: boolean;
    projectId?: string | null;
  }) => (
    <>
      <button
        type="button"
        data-testid="model-thinking-select"
        data-effort={thinkingEffort ?? 'default'}
        data-inherited={String(thinkingEffort === undefined)}
        data-readonly={String(Boolean(readOnly))}
        data-project-id={projectId ?? ''}
        disabled={disabled}
        onClick={() => onThinkingEffortChange?.('high')}
      />
      <button
        type="button"
        data-testid="inherit-thinking-effort"
        disabled={disabled}
        onClick={() => onThinkingEffortChange?.(undefined)}
      />
    </>
  ),
}));

vi.mock('@/service/spaceApi', () => ({
  proxyUpdateSpaceProject: vi.fn().mockResolvedValue({}),
}));

describe('BoxFooter', () => {
  beforeEach(() => {
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      composerThinkingEffort: undefined,
    });
  });

  it('lets Workspace and New session change thinking effort without a project', () => {
    render(<BoxFooter sessionMode={SessionMode.SINGLE_AGENT} interactive />);

    const selector = screen.getByTestId('model-thinking-select');
    expect(screen.getByTestId('session-mode-toggle')).toHaveAttribute(
      'data-readonly',
      'false'
    );
    expect(screen.getAllByTestId('model-thinking-select')).toHaveLength(1);
    expect(selector).toHaveAttribute('data-readonly', 'false');
    expect(selector).toHaveAttribute('data-effort', 'default');
    expect(selector).toHaveAttribute('data-inherited', 'true');
    expect(selector).toHaveAttribute('data-project-id', '');
    expect(selector).not.toBeDisabled();
    expect(
      useProjectStore.getState().getComposerThinkingEffort()
    ).toBeUndefined();

    fireEvent.click(selector);

    expect(useProjectStore.getState().getComposerThinkingEffort()).toBe(
      ThinkingEffort.HIGH
    );

    fireEvent.click(screen.getByTestId('inherit-thinking-effort'));

    expect(
      useProjectStore.getState().getComposerThinkingEffort()
    ).toBeUndefined();
  });

  it('locks session mode on a running Session while thinking effort stays selectable', () => {
    const projectId = useProjectStore
      .getState()
      .createProject('Running session', undefined, 'project_footer_effort');

    render(
      <BoxFooter sessionMode={SessionMode.SINGLE_AGENT} projectId={projectId} />
    );

    const selector = screen.getByTestId('model-thinking-select');
    expect(screen.getByTestId('session-mode-toggle')).toHaveAttribute(
      'data-readonly',
      'true'
    );
    expect(screen.getAllByTestId('model-thinking-select')).toHaveLength(1);
    expect(selector).toHaveAttribute('data-readonly', 'false');
    expect(selector).toHaveAttribute('data-effort', 'default');
    expect(selector).toHaveAttribute('data-inherited', 'true');
    expect(selector).toHaveAttribute('data-project-id', projectId);
    expect(selector).not.toBeDisabled();

    fireEvent.click(selector);

    expect(useProjectStore.getState().getProjectThinkingEffort(projectId)).toBe(
      ThinkingEffort.HIGH
    );
    expect(
      useProjectStore.getState().getComposerThinkingEffort()
    ).toBeUndefined();

    fireEvent.click(screen.getByTestId('inherit-thinking-effort'));

    expect(
      useProjectStore.getState().getProjectThinkingEffortOverride(projectId)
    ).toBeUndefined();
  });

  it('disables the single merged selector with the BottomBox footer', () => {
    render(
      <BoxFooter sessionMode={SessionMode.SINGLE_AGENT} interactive disabled />
    );

    expect(screen.getAllByTestId('model-thinking-select')).toHaveLength(1);
    expect(screen.getByTestId('model-thinking-select')).toBeDisabled();
  });
});
