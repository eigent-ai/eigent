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

import { PdfPreview } from '@/components/Folder/PdfPreview';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));
vi.mock('@/lib/pdfPreview', () => ({ openPdfPreview: openMock }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function PdfHarness(
  props: Omit<ComponentProps<typeof PdfPreview>, 'toolbarContainer'>
) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  return (
    <>
      <header ref={setToolbar} />
      <PdfPreview {...props} toolbarContainer={toolbar} />
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 600 } }]);
      }
      disconnect() {}
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function documentFixture(renderPromise = Promise.resolve()) {
  const cancel = vi.fn();
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: vi.fn(() => ({ promise: renderPromise, cancel })),
    getTextContent: vi
      .fn()
      .mockResolvedValue({ items: [{ str: 'Readable PDF content' }] }),
  };
  const pdf = { numPages: 2, getPage: vi.fn().mockResolvedValue(page) };
  const destroy = vi.fn().mockResolvedValue(undefined);
  openMock.mockReturnValue({ promise: Promise.resolve(pdf), destroy });
  return { pdf, page, destroy, cancel };
}
describe('PDF rendering outcomes', () => {
  it('keeps loading until the page render completes, then permits page navigation', async () => {
    const pending = deferred<void>();
    const { pdf } = documentFixture(pending.promise);
    render(<PdfHarness url="/file.pdf" size={500} />);
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(1));
    expect(screen.getByText('Loading PDF…')).toHaveTextContent('Loading PDF');
    await act(async () => pending.resolve());
    expect(screen.queryByText('Loading PDF…')).toBeNull();
    expect(await screen.findByText('Readable PDF content')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Next page' }).closest('header')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(2));
  });
  it('shows password recovery instead of a blank canvas', async () => {
    const error = new Error('password');
    error.name = 'PasswordException';
    openMock.mockReturnValue({
      promise: Promise.reject(error),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    render(<PdfHarness url="/locked.pdf" size={500} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'needs a password'
    );
    expect(
      screen.getByRole('button', { name: 'Retry' }).closest('header')
    ).not.toBeNull();
    expect(screen.getByRole('alert').querySelector('button')).toBeNull();
  });
  it('cancels a render and destroys its document when switching files', async () => {
    const pending = deferred<void>();
    const old = documentFixture(pending.promise);
    const { rerender } = render(<PdfHarness key="a" url="/a.pdf" size={500} />);
    await waitFor(() => expect(old.page.render).toHaveBeenCalled());
    documentFixture();
    rerender(<PdfHarness key="b" url="/b.pdf" size={500} />);
    expect(old.cancel).toHaveBeenCalled();
    expect(old.destroy).toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(await screen.findByText('Readable PDF content')).toBeInTheDocument();
  });
  it('shows failure and retries when document loading rejects', async () => {
    openMock.mockReturnValueOnce({
      promise: Promise.reject(new Error('invalid PDF')),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    documentFixture();
    render(<PdfHarness url="/bad.pdf" size={500} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be previewed'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('Readable PDF content')).toBeInTheDocument();
  });
  it('ends a stalled load with a recoverable error', async () => {
    const pending = deferred<unknown>();
    const destroy = vi.fn().mockResolvedValue(undefined);
    openMock.mockReturnValue({ promise: pending.promise, destroy });
    vi.useFakeTimers();
    render(<PdfHarness url="/stalled.pdf" size={500} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be previewed'
    );
    expect(destroy).toHaveBeenCalled();
  });
});
