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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchHistoryDialog } from '../../../src/components/SearchHistoryDialog';

// ---- Mocks ----

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: { activeTaskId: undefined },
    projectStore: {
      getProjectById: vi.fn(() => null),
      setHistoryId: vi.fn(),
      setActiveProject: vi.fn(),
    },
  }),
}));

vi.mock('@/store/globalStore', () => ({
  useGlobalStore: () => ({ history_type: 'list' }),
}));

const proxyFetchDeleteMock = vi.fn().mockResolvedValue({ code: 0 });
vi.mock('@/api/http', () => ({
  proxyFetchDelete: (...args: any[]) => proxyFetchDeleteMock(...args),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ email: 'test@example.com' }),
}));

vi.mock('@/service/historyApi', () => ({
  fetchHistoryTasks: (setter: (tasks: any[]) => void) => {
    setter([
      {
        id: '1',
        task_id: 'task-1',
        project_id: 'project-1',
        question: 'My history item',
      },
    ]);
  },
}));

vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({ open, children }: any) =>
    open ? <div data-testid="cmd-dialog">{children}</div> : null,
  CommandEmpty: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandInput: (props: any) => <input aria-label="command-input" {...props} />,
  CommandItem: ({ children, onSelect }: any) => (
    <div role="button" tabIndex={0} onClick={() => onSelect?.('')}>
      {children}
    </div>
  ),
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandSeparator: () => <hr />,
}));

vi.mock('../../../src/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('../../../src/components/ui/dialog', () => ({
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@radix-ui/react-visually-hidden', () => ({
  VisuallyHidden: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('lucide-react', () => ({
  Search: (props: any) => <div data-testid="search-icon" {...props} />,
  ScanFace: (props: any) => <div data-testid="scanface-icon" {...props} />,
  Trash2: (props: any) => <div data-testid="trash-icon" {...props} />,
}));

vi.mock('@/components/GroupedHistoryView', () => ({
  default: () => <div data-testid="grouped-history-view" />,
}));

vi.mock('@/lib', () => ({
  replayProject: vi.fn(),
}));

describe('SearchHistoryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('deletes a history item from list view', async () => {
    const user = userEvent.setup();
    render(<SearchHistoryDialog />);

    // Open dialog
    await user.click(screen.getByRole('button'));

    // History item should appear
    await waitFor(() => {
      expect(screen.getByText('My history item')).toBeInTheDocument();
    });

    // Click delete button
    const deleteButton = screen.getByRole('button', { name: 'Delete history' });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(proxyFetchDeleteMock).toHaveBeenCalledWith('/api/chat/history/1');
    });

    expect((window as any).ipcRenderer.invoke).toHaveBeenCalledWith(
      'delete-task-files',
      'test@example.com',
      'task-1',
      'project-1'
    );

    await waitFor(() => {
      expect(screen.queryByText('My history item')).not.toBeInTheDocument();
    });
  });
});
