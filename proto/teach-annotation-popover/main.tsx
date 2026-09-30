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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  applyThemeContractV2,
  createDefaultThemeContractV2,
} from '@/lib/themeTokens';
import '@/style/index.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import { Folder, GraduationCap, MessageSquarePlus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import Connected from './Connected';
import Expandable from './Expandable';
import './prototype.css';
import Quiet from './Quiet';

const variants = [
  { name: 'Quiet', component: Quiet },
  { name: 'Connected', component: Connected },
  { name: 'Expandable', component: Expandable },
];

function initialVariant() {
  const value = Number(new URLSearchParams(location.search).get('v'));
  return value >= 1 && value <= variants.length ? value - 1 : 0;
}

function applyPrototypeTheme(mode: 'light' | 'dark') {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.colorTheme = 'eigent';
  root.style.colorScheme = mode;
  applyThemeContractV2(
    createDefaultThemeContractV2(mode, { themeId: 'eigent' }),
    root
  );
}

applyPrototypeTheme('light');

function Prototype() {
  const [active, setActive] = useState(initialVariant);
  const [mountKey, setMountKey] = useState(0);
  const [open, setOpen] = useState(true);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const picker = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const moveHighlight = useCallback(() => {
    const current = buttons.current[active];
    if (!current || !highlight.current) return;
    highlight.current.style.width = `${current.offsetWidth}px`;
    highlight.current.style.transform = `translateX(${current.offsetLeft}px)`;
  }, [active]);

  const setVariant = (index: number) => {
    if (index < 0 || index >= variants.length) return;
    setActive(index);
    setMountKey((key) => key + 1);
    setOpen(true);
    const url = new URL(location.href);
    url.searchParams.set('v', String(index + 1));
    history.replaceState(null, '', url);
  };

  useLayoutEffect(moveHighlight, [moveHighlight]);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        picker.current?.setAttribute('data-ready', '')
      )
    );
    window.addEventListener('resize', moveHighlight);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', moveHighlight);
    };
  }, [moveHighlight]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= variants.length) setVariant(number - 1);
      else if (event.key === 'ArrowRight')
        setVariant((active + 1) % variants.length);
      else if (event.key === 'ArrowLeft')
        setVariant((active - 1 + variants.length) % variants.length);
      else if (event.key.toLowerCase() === 'r') {
        setMountKey((key) => key + 1);
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const save = () => {
    if (!comment.trim()) return;
    setSaved(comment.trim());
    setOpen(false);
  };
  const ActiveVariant = variants[active].component;

  return (
    <div className="proto-app">
      <header className="proto-topbar">
        <div className="proto-brand">Eigent</div>
        <span className="proto-space">
          <DsIcon icon={Folder} recipe="main" /> new test
        </span>
        <span className="proto-teach-tag">
          <DsIcon icon={GraduationCap} recipe="main" /> Teach mode
        </span>
        <div className="proto-topbar-actions">
          <span className="proto-only-label">
            Prototype only · no app data is saved
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = theme === 'light' ? 'dark' : 'light';
              setTheme(next);
              applyPrototypeTheme(next);
            }}
          >
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </Button>
        </div>
      </header>
      <div className="proto-layout">
        <aside className="proto-sidebar">
          <span className="proto-sidebar-heading">Workspace</span>
          <span className="proto-sidebar-heading">Files</span>
          <span className="proto-sidebar-divider" />
          <span className="proto-sidebar-meta">Sessions</span>
          <span className="proto-session-row">
            Write Content in Markdown and PDF Format
          </span>
        </aside>
        <main className="proto-main">
          <div className="proto-session-heading">
            Write Content in Markdown and PDF Format
          </div>
          <div className="proto-chat">
            <div className="proto-user-message">
              write in markdown and pdf formate
            </div>
            <div className="proto-run-meta">Worked for 47s</div>
            <article className="proto-agent-message">
              <p>
                I have created the poem in both{' '}
                <mark>Markdown and PDF formats</mark> in your workspace:
              </p>
              <ul>
                <li>
                  <strong>Markdown:</strong> <code>london_poem.md</code>
                </li>
                <li>
                  <strong>PDF:</strong> <code>london_poem.pdf</code>
                </li>
              </ul>
              <h2>Poem Text</h2>
              <h3>London</h3>
              <p>
                Grey mist upon the winding Thames,
                <br />
                Where stone and shadow softly meet,
                <br />A crown of old and quiet gems
                <br />
                Above the hum of rain-washed street.
              </p>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="text"
                    size="sm"
                    className="proto-comment-trigger"
                  >
                    <DsIcon icon={MessageSquarePlus} recipe="main" /> Add
                    comment
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={10}
                  className="proto-annotation-popover"
                  onInteractOutside={(event) => {
                    if ((event.target as Element).closest('.proto-picker'))
                      event.preventDefault();
                  }}
                >
                  <ActiveVariant
                    key={`${active}-${mountKey}`}
                    value={comment}
                    onChange={setComment}
                    onSave={save}
                  />
                </PopoverContent>
              </Popover>
              {saved ? (
                <p className="proto-saved-note">
                  Comment saved in this prototype: {saved}
                </p>
              ) : null}
            </article>
          </div>
        </main>
        <aside className="proto-sidepanel">
          <span>Summary</span>
          <span>
            Files <b>2</b>
          </span>
          <span>london_poem.md</span>
          <span>london_poem.pdf</span>
        </aside>
      </div>
      <nav
        ref={picker}
        className="proto-picker"
        aria-label="Prototype variants"
      >
        <span
          ref={highlight}
          className="proto-picker-highlight"
          aria-hidden="true"
        ></span>
        {variants.map(({ name }, index) => (
          <button
            key={name}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            className="proto-picker-item"
            data-active={index === active ? '' : undefined}
            aria-current={index === active ? 'true' : undefined}
            onClick={() => setVariant(index)}
          >
            {name}
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Prototype />);
