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

import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useTeachModeStore, type TeachFeedback } from '@/store/teachModeStore';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationTab } from './AnnotationTab';

const entries: Record<string, TeachFeedback> = {
  poem: {
    id: 'poem',
    spaceId: 'space-1',
    projectId: 'session-1',
    sourceType: 'run',
    sourceId: 'run:poem',
    contextLabel: 'London poem',
    selectedText: 'A heartbeat older than the time.',
    comment: 'Make the final image more specific.',
    createdAt: 20,
    updatedAt: 20,
  },
  pdf: {
    id: 'pdf',
    spaceId: 'space-1',
    projectId: 'session-1',
    sourceType: 'file',
    sourceId: 'file:summary.pdf',
    contextLabel: 'summary.pdf',
    comment: 'The PDF title should match the Markdown title.',
    createdAt: 10,
    updatedAt: 100,
  },
  other: {
    id: 'other',
    spaceId: 'space-1',
    projectId: 'session-2',
    sourceType: 'agent-log',
    sourceId: 'log:other',
    contextLabel: 'Audit check',
    comment: 'Verify the balance.',
    createdAt: 5,
    updatedAt: 200,
  },
};

describe('AnnotationTab', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    useSpaceStore.setState({
      activeSpaceId: 'space-1',
      projectsBySpaceId: {
        'space-1': {
          'session-1': {
            id: 'session-1',
            spaceId: 'space-1',
            name: 'London poem session',
            status: 'active',
            createdAt: 100,
            updatedAt: 100,
          },
          'session-2': {
            id: 'session-2',
            spaceId: 'space-1',
            name: 'Recent audit session',
            status: 'active',
            createdAt: 200,
            updatedAt: 200,
          },
        },
      },
    });
    usePageTabStore.setState({ sessionPreviewProjectId: 'session-1' });
    useTeachModeStore.setState({
      enabled: true,
      feedbackById: entries,
      pendingAnnotation: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('filters from the header search and folds or expands the visible cards', async () => {
    render(<AnnotationTab />);

    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Search annotations…' })
    ).not.toBeInTheDocument();
    const searchButton = screen.getByRole('button', {
      name: 'Search annotations…',
    });
    expect(searchButton.closest('header')).toBeInTheDocument();
    fireEvent.click(searchButton);
    const searchInput = await screen.findByRole('textbox', {
      name: 'Search annotations…',
    });

    expect(screen.getByText('London poem')).toBeInTheDocument();
    expect(screen.getByText('summary.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Audit check')).not.toBeInTheDocument();
    expect(screen.getByText('Selected work')).toBeInTheDocument();
    expect(
      screen.getByText('Selected work').closest('[aria-hidden]')
    ).toHaveAttribute('aria-hidden', 'false');

    fireEvent.change(searchInput, { target: { value: 'PDF title' } });
    expect(screen.getByText('summary.pdf')).toBeInTheDocument();
    expect(screen.queryByText('London poem')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(
      screen
        .getAllByText('Your comment')
        .every(
          (label) =>
            label.closest('[aria-hidden]')?.getAttribute('aria-hidden') ===
            'false'
        )
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Fold all' }));
    expect(
      screen
        .getAllByText('Your comment')
        .every(
          (label) =>
            label.closest('[aria-hidden]')?.getAttribute('aria-hidden') ===
            'true'
        )
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /This space/ }));
    expect(screen.getByText('summary.pdf')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: 'Audit' } });
    expect(screen.getByText('Audit check')).toBeInTheDocument();
  });

  it('edits a comment and requires a second action to delete its card', () => {
    render(<AnnotationTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit: London poem' }));
    const comment = screen.getByRole('textbox', { name: 'Comment' });
    expect(comment).toHaveValue('Make the final image more specific.');
    fireEvent.change(comment, {
      target: { value: '  Use a clearer final image.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useTeachModeStore.getState().feedbackById.poem.comment).toBe(
      'Use a clearer final image.'
    );
    expect(screen.getByText('Use a clearer final image.')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete: London poem' })
    );
    expect(useTeachModeStore.getState().feedbackById.poem).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useTeachModeStore.getState().feedbackById.poem).toBeDefined();

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete: London poem' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useTeachModeStore.getState().feedbackById.poem).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'This session (1)' })
    ).toBeInTheDocument();
  });

  it('groups recent sessions first and sorts each session by annotation creation time', () => {
    render(<AnnotationTab />);
    fireEvent.click(screen.getByRole('button', { name: /This space/ }));

    const groups = screen
      .getAllByRole('region')
      .filter((group) =>
        ['Recent audit session', 'London poem session'].includes(
          group.getAttribute('aria-label') ?? ''
        )
      );
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Recent audit session',
      'London poem session',
    ]);
    expect(
      groups[1].querySelector('[data-orientation="horizontal"]')
    ).toBeInTheDocument();
    expect(
      within(groups[1])
        .getAllByRole('article')
        .map((article) => article.textContent)
    ).toEqual([
      expect.stringContaining('London poem'),
      expect.stringContaining('summary.pdf'),
    ]);
    expect(
      within(groups[1]).getByRole('button', { name: 'View work: London poem' })
    ).toHaveAttribute('data-variant', 'ghost');
  });

  it('groups multiple annotations under their Run within the Session', () => {
    useTeachModeStore.setState({
      feedbackById: {
        first: { ...entries.poem, id: 'first', runId: 'run-1' },
        second: {
          ...entries.poem,
          id: 'second',
          runId: 'run-1',
          comment: 'Check the rhythm.',
        },
        third: { ...entries.pdf, id: 'third', runId: 'run-2' },
      },
    });
    render(<AnnotationTab />);

    const session = screen.getByRole('region', { name: 'London poem session' });
    expect(
      within(session).getByRole('region', { name: 'Run run-1' })
    ).toHaveTextContent('Make the final image more specific.');
    expect(
      within(session).getByRole('region', { name: 'Run run-1' })
    ).toHaveTextContent('Check the rhythm.');
    expect(
      within(session).getByRole('region', { name: 'Run run-2' })
    ).toHaveTextContent('The PDF title should match the Markdown title.');
  });

  it('does not follow a matching file source in another Session', () => {
    useTeachModeStore.setState({
      feedbackById: {
        collision: {
          ...entries.pdf,
          id: 'collision',
          projectId: 'session-2',
        },
      },
    });
    render(<AnnotationTab />);
    fireEvent.click(screen.getByRole('button', { name: /This space/ }));

    const wrongSource = document.createElement('div');
    wrongSource.dataset.teachFeedbackSource = 'file:summary.pdf';
    document.body.append(wrongSource);
    const scroll = vi.fn();
    wrongSource.scrollIntoView = scroll;
    const selectTab = vi.spyOn(
      usePageTabStore.getState(),
      'selectSessionPreviewTab'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'View work: summary.pdf' })
    );

    expect(scroll).not.toHaveBeenCalled();
    expect(selectTab).not.toHaveBeenCalled();
    wrongSource.remove();
  });

  it('opens the annotated Review file using its stored path', () => {
    useTeachModeStore.setState({
      feedbackById: {
        review: {
          ...entries.pdf,
          id: 'review',
          sourceType: 'review',
          sourceId: 'review:run-1:src/second.ts',
          runId: 'run-1',
          contextLabel: 'Second change',
          contextDetail: 'Review',
          sourcePath: 'src/second.ts',
        },
      },
    });
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    render(<AnnotationTab />);
    const openReview = vi.spyOn(
      usePageTabStore.getState(),
      'openReviewPreview'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'View work: Second change' })
    );

    expect(openReview).toHaveBeenCalledWith({
      runId: 'run-1',
      path: 'src/second.ts',
    });
  });
});
