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
  getRichInputSelection,
  RichChatInput,
} from '@/components/ChatBox/BottomBox/RichChatInput';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('RichChatInput motion', () => {
  it('removes placeholder copy synchronously when text appears', () => {
    const { rerender } = render(
      <RichChatInput
        value=""
        onChange={vi.fn()}
        placeholders={['Ask a follow-up']}
      />
    );

    expect(screen.getByText('Ask a follow-up')).toBeInTheDocument();

    rerender(
      <RichChatInput
        value="Review this"
        onChange={vi.fn()}
        placeholders={['Ask a follow-up']}
      />
    );

    expect(screen.queryByText('Ask a follow-up')).toBeNull();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-placeholder');
  });
});

type OnChange = (value: string, cursorOffset?: number) => void;

function ControlledInput({ onChange }: { onChange: OnChange }) {
  const [value, setValue] = useState('');
  return (
    <RichChatInput
      value={value}
      onChange={(next, cursorOffset) => {
        setValue(next);
        onChange(next, cursorOffset);
      }}
    />
  );
}

function renderControlled() {
  const onChange = vi.fn<OnChange>();
  render(<ControlledInput onChange={onChange} />);
  return { editor: screen.getByRole('textbox'), onChange };
}

function placeCaret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Replace the editor DOM as a browser edit would, then report the input. */
function editTo(editor: HTMLElement, html: string) {
  editor.innerHTML = html;
  placeCaret(editor, editor.childNodes.length);
  fireEvent.input(editor);
}

/**
 * jsdom has no editing commands. This mirrors Chromium's `insertText` in an
 * empty contenteditable: the first line stays a text node, every following
 * line becomes a new `<div>` paragraph (an empty one holds a `<br>`), and the
 * caret ends after the inserted text.
 */
function installChromiumInsertText(editor: HTMLElement) {
  const execCommand = vi.fn(
    (command: string, _showUi?: boolean, text = ''): boolean => {
      if (command !== 'insertText') return false;
      const [first, ...rest] = text.split('\n');
      editor.replaceChildren();
      if (first) editor.append(first);
      for (const line of rest) {
        const paragraph = document.createElement('div');
        paragraph.append(line || document.createElement('br'));
        editor.append(paragraph);
      }
      const lastLine = rest.length > 0 ? editor.lastElementChild! : editor;
      const lastText = lastLine.lastChild;
      if (lastText?.nodeType === Node.TEXT_NODE) {
        placeCaret(lastText, lastText.textContent!.length);
      } else {
        placeCaret(lastLine, 0);
      }
      fireEvent.input(editor);
      return true;
    }
  );
  document.execCommand = execCommand;
  return execCommand;
}

function pastePlainText(editor: HTMLElement, text: string) {
  fireEvent.paste(editor, {
    clipboardData: {
      items: [],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  });
}

describe('RichChatInput line breaks', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('keeps the line breaks of pasted multi-line text', () => {
    const { editor, onChange } = renderControlled();
    const execCommand = installChromiumInsertText(editor);

    pastePlainText(editor, 'line one\nline two\nline three');

    expect(execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'line one\nline two\nline three'
    );
    expect(onChange).toHaveBeenLastCalledWith(
      'line one\nline two\nline three',
      28
    );
    expect(editor.innerHTML).toBe('line one<br>line two<br>line three');
  });

  it('pastes Windows line endings and a trailing newline as editable lines', () => {
    const { editor, onChange } = renderControlled();
    const execCommand = installChromiumInsertText(editor);

    pastePlainText(editor, 'first\r\nsecond\r\n');

    expect(execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'first\nsecond\n'
    );
    expect(onChange).toHaveBeenLastCalledWith('first\nsecond\n', 13);
    // The last <br> keeps the empty last line, and the caret on it, visible.
    expect(editor.innerHTML).toBe('first<br>second<br><br>');
    expect(window.getSelection()!.anchorNode).toBe(editor);
    expect(window.getSelection()!.anchorOffset).toBe(4);
    expect(getRichInputSelection(editor)).toEqual({ start: 13, end: 13 });
  });

  it('pastes text that looks like HTML as plain text', () => {
    const { editor, onChange } = renderControlled();
    installChromiumInsertText(editor);

    pastePlainText(editor, '<b>bold</b>\n<img src=x onerror=alert(1)>');

    expect(onChange).toHaveBeenLastCalledWith(
      '<b>bold</b>\n<img src=x onerror=alert(1)>',
      40
    );
    expect(editor.querySelector('b, img')).toBeNull();
    expect(editor.textContent).toBe('<b>bold</b><img src=x onerror=alert(1)>');
  });

  it.each([
    [
      'a blank pasted line',
      'one<div><br></div><div>three</div>',
      'one\n\nthree',
    ],
    [
      'nested paragraphs',
      '<div>one</div><div><div>two</div></div>',
      'one\ntwo',
    ],
    ['a line break before a paragraph', 'one<br><div>two</div>', 'one\ntwo'],
    [
      'a paste in the middle of earlier lines',
      'l1<br>lX<div>Y2<br>l3</div>',
      'l1\nlX\nY2\nl3',
    ],
    ['Shift+Enter inside a line', 'ab<br>c', 'ab\nc'],
    ['Shift+Enter at the end of a line', 'abc<br><br>', 'abc\n'],
    ['Shift+Enter as preserved newlines', 'abc\n\n', 'abc\n'],
    [
      'Shift+Enter at the end of a pasted line',
      'a<div>b<br><br></div>',
      'a\nb\n',
    ],
  ])('reads %s', (_case, html, expected) => {
    const { editor, onChange } = renderControlled();

    editTo(editor, html);

    expect(onChange).toHaveBeenLastCalledWith(expected, expected.length);
    expect(getRichInputSelection(editor)).toEqual({
      start: expected.length,
      end: expected.length,
    });
  });

  it('keeps #skill and @connector tokens on pasted lines', () => {
    const { editor, onChange } = renderControlled();

    editTo(
      editor,
      'Use #pdf with @Gmail<div>then open https://example.com</div>'
    );

    expect(onChange).toHaveBeenLastCalledWith(
      'Use #pdf with @Gmail\nthen open https://example.com',
      50
    );
    expect(editor.querySelector('[data-rich-skill]')).toHaveTextContent('#pdf');
    expect(editor.querySelector('[data-rich-connector]')).toHaveTextContent(
      '@Gmail'
    );
    expect(editor.querySelector('a[data-rich-url]')).toHaveTextContent(
      'https://example.com'
    );
    expect(editor.querySelectorAll('br')).toHaveLength(1);
  });

  it('keeps the caret at the same text position inside a pasted line', () => {
    const { editor, onChange } = renderControlled();
    editor.innerHTML = 'one<div>two</div><div>three</div>';
    placeCaret(editor.lastChild!.firstChild!, 2);

    fireEvent.input(editor);

    expect(onChange).toHaveBeenLastCalledWith('one\ntwo\nthree', 10);
    const selection = window.getSelection()!;
    expect(selection.anchorNode?.textContent).toBe('three');
    expect(selection.anchorOffset).toBe(2);
  });

  it('shows blank and trailing lines of a value and reads them back unchanged', () => {
    const onChange = vi.fn<OnChange>();
    render(<RichChatInput value={'first\n\nthird\n'} onChange={onChange} />);
    const editor = screen.getByRole('textbox');

    expect(editor.innerHTML).toBe('first<br><br>third<br><br>');
    fireEvent.blur(editor);
    expect(onChange).not.toHaveBeenCalled();

    // Before the last <br>: on the empty last line.
    placeCaret(editor, 5);
    fireEvent.input(editor);
    expect(onChange).toHaveBeenLastCalledWith('first\n\nthird\n', 13);
  });
});
