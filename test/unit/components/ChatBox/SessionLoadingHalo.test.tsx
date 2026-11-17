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

import {
  SESSION_LOADING_MIN_VISIBLE_MS,
  SESSION_LOADING_SETTLE_MS,
  SESSION_LOADING_SHOW_DELAY_MS,
  SessionLoadingCover,
  SessionLoadingHalo,
  useReportSessionLoading,
} from '@/components/ChatBox/SessionLoadingHalo';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('SessionLoadingHalo', () => {
  it('announces loading and takes no pointer input', () => {
    render(<SessionLoadingHalo active label="Loading history" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading history');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
    expect(status.querySelector('.session-loading-halo')).not.toBeNull();
  });

  it('shows the Eigent mark at the centre without announcing it', () => {
    render(<SessionLoadingHalo active label="Loading history" />);

    const logo = screen
      .getByRole('status')
      .querySelector<HTMLElement>('.session-loading-halo-logo');
    expect(logo?.parentElement).toHaveClass(
      'flex',
      'items-center',
      'justify-center'
    );
    const marks = logo?.querySelectorAll('img') ?? [];
    expect(marks).toHaveLength(2);
    marks.forEach((mark) => expect(mark).toHaveAttribute('alt', ''));
  });

  it('leaves once content has loaded', async () => {
    const { rerender } = render(
      <SessionLoadingHalo active label="Loading history" />
    );

    rerender(<SessionLoadingHalo active={false} label="Loading history" />);

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
  });

  it('carries on when another surface takes over the same wait', () => {
    const first = render(<SessionLoadingHalo active label="Loading history" />);
    const second = render(
      <SessionLoadingHalo active label="Loading history" />
    );
    first.unmount();

    const halo = second.container.querySelector<HTMLElement>(
      '.session-loading-halo'
    );
    expect(halo?.style.getPropertyValue('--halo-elapsed')).toMatch(/^\d+ms$/);
    second.unmount();
  });

  it('starts from the bottom for a new wait', async () => {
    const first = render(<SessionLoadingHalo active label="Loading history" />);
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 450));

    const { container } = render(
      <SessionLoadingHalo active label="Loading history" />
    );
    const halo = container.querySelector<HTMLElement>('.session-loading-halo');
    expect(halo?.style.getPropertyValue('--halo-elapsed')).toBe('0ms');
  });
});

function Timeline({ loading }: { loading: boolean }) {
  const pageShowsLoading = useReportSessionLoading(
    'timeline',
    loading,
    'Loading history'
  );
  return (
    <div data-testid="timeline" data-page-shows-loading={pageShowsLoading}>
      Messages
    </div>
  );
}

function Page({
  sessionKey = 'a',
  loading = false,
  timelineLoading = false,
  skip = false,
}: {
  sessionKey?: string;
  loading?: boolean;
  timelineLoading?: boolean;
  skip?: boolean;
}) {
  return (
    <SessionLoadingCover
      sessionKey={sessionKey}
      loading={loading}
      skip={skip}
      label="Loading Session"
    >
      <header>Session title</header>
      <Timeline loading={timelineLoading} />
    </SessionLoadingCover>
  );
}

const content = () =>
  document.querySelector('[data-session-loading-cover]') as HTMLElement;
const isHidden = () => content().dataset.sessionLoadingCover === 'hidden';

describe('SessionLoadingCover', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a Session that is ready at once without any halo', () => {
    render(<Page />);

    expect(isHidden()).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    // Without a halo, the content appears instead of fading in.
    expect(screen.getByText('Session title').parentElement).not.toHaveClass(
      'transition-opacity'
    );
  });

  it('shows no halo for a load faster than the delay, then the content', () => {
    const { rerender } = render(<Page loading />);
    expect(isHidden()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS - 50);
    });
    rerender(<Page />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SETTLE_MS);
    });

    expect(isHidden()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('covers the whole Session, header included, with one halo for a slow load', () => {
    render(<Page loading />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS);
    });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading Session');
    expect(status.parentElement).toBe(content());
    expect(screen.getAllByRole('status')).toHaveLength(1);
    // The header and chat stay mounted so they keep loading, but hidden.
    const hiddenContent = screen.getByText('Session title').parentElement;
    expect(hiddenContent).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenContent).toHaveAttribute('inert');
  });

  it('keeps a halo that has just appeared up for its minimum time', () => {
    const { rerender } = render(<Page loading />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS);
    });
    rerender(<Page />);

    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_MIN_VISIBLE_MS - 100);
    });
    expect(isHidden()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(isHidden()).toBe(false);
    expect(screen.getByText('Session title').parentElement).toHaveClass(
      'transition-opacity'
    );
    // The halo now fades out over the content ('leaves once content has
    // loaded' covers its exit).
  });

  it("waits for the timeline's first history load and draws its halo for it", () => {
    const { rerender } = render(<Page timelineLoading />);
    expect(screen.getByTestId('timeline')).toHaveAttribute(
      'data-page-shows-loading',
      'true'
    );
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading history');

    rerender(<Page />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_MIN_VISIBLE_MS);
    });
    expect(isHidden()).toBe(false);
  });

  it('leaves later loading to the timeline once the Session has shown', () => {
    const { rerender } = render(<Page />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SETTLE_MS);
    });
    rerender(<Page timelineLoading />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS * 2);
    });

    expect(isHidden()).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('timeline')).toHaveAttribute(
      'data-page-shows-loading',
      'false'
    );
  });

  it('shows a Session the user has just started at once', () => {
    render(<Page loading timelineLoading skip />);

    expect(isHidden()).toBe(false);
    expect(screen.getByTestId('timeline')).toHaveAttribute(
      'data-page-shows-loading',
      'false'
    );
  });

  it('hides the Session before its first paint when the timeline is loading', () => {
    render(<Page timelineLoading />);

    expect(isHidden()).toBe(true);
  });

  it('counts a part that starts loading just after it mounts', () => {
    const { rerender } = render(<Page />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SETTLE_MS / 2);
    });
    rerender(<Page timelineLoading />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SHOW_DELAY_MS);
    });

    expect(isHidden()).toBe(true);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('starts a new first load when another Session opens', () => {
    const { rerender } = render(<Page sessionKey="a" />);
    act(() => {
      vi.advanceTimersByTime(SESSION_LOADING_SETTLE_MS);
    });
    expect(isHidden()).toBe(false);

    rerender(<Page sessionKey="b" loading />);
    expect(isHidden()).toBe(true);
  });
});
