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
import { Textarea } from '@/components/ui/textarea';
import {
  applyThemeContractV2,
  createDefaultThemeContractV2,
} from '@/lib/themeTokens';
import '@/style/index.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import {
  ChevronDown,
  ChevronUp,
  Folder,
  GraduationCap,
  Plus,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import Baseline from './Baseline';
import DocumentCards from './DocumentCards';
import Timeline from './Timeline';
import { initialAnnotations, type Annotation } from './data';
import './prototype.css';

const variants = [
  { name: 'Flat row', component: Baseline },
  { name: 'Work + note', component: DocumentCards },
  { name: 'Timeline', component: Timeline },
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
  const [scope, setScope] = useState<'session' | 'space'>('session');
  const [expanded, setExpanded] = useState(
    () => new Set(initialAnnotations.slice(0, 2).map((item) => item.id))
  );
  const [selectedSource, setSelectedSource] = useState<Annotation | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const picker = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const items = annotations.filter(
    (item) => scope === 'space' || item.sessionId === 'london'
  );
  const ActiveVariant = variants[active].component;
  const allExpanded = items.every((item) => expanded.has(item.id));

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
      else if (event.key.toLowerCase() === 'r') setMountKey((key) => key + 1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const toggle = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = () => {
    if (!comment.trim()) return;
    const item: Annotation = {
      id: `prototype-${crypto.randomUUID()}`,
      sessionId: 'london',
      context: 'This session',
      detail: 'Whole run',
      quote: 'New annotation on the current session',
      comment: comment.trim(),
      time: 'Just now',
    };
    setAnnotations((previous) => [item, ...previous]);
    setExpanded((previous) => new Set(previous).add(item.id));
    setComment('');
    setComposerOpen(false);
  };

  return (
    <div className="proto-app">
      <header className="proto-topbar">
        <strong>Eigent</strong>
        <span className="proto-space">
          <DsIcon icon={Folder} recipe="main" /> new test
        </span>
        <span className="proto-teach-tag">
          <DsIcon icon={GraduationCap} recipe="main" /> Teach mode
        </span>
        <span className="proto-spacer" />
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
          <h1>Write Content in Markdown and PDF Format</h1>
          <div className="proto-message">
            Write a London poem in Markdown and PDF format.
          </div>
          <article className="proto-agent-message">
            <strong>Final answer</strong>
            <p>
              I created the poem in both Markdown and PDF formats. The files are
              ready in your workspace.
            </p>
            <span>london_poem.md · london_poem.pdf</span>
          </article>
        </main>
        <aside className="proto-panel">
          <div className="proto-panel-header">
            <div className="proto-scopes">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={scope === 'session'}
                className={
                  scope === 'session'
                    ? 'proto-scope-active !text-ds-ink-inverse'
                    : ''
                }
                onClick={() => setScope('session')}
              >
                This session (
                {
                  annotations.filter((item) => item.sessionId === 'london')
                    .length
                }
                )
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={scope === 'space'}
                className={
                  scope === 'space'
                    ? 'proto-scope-active !text-ds-ink-inverse'
                    : ''
                }
                onClick={() => setScope('space')}
              >
                This space ({annotations.length})
              </Button>
            </div>
            <div className="proto-header-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    items.forEach((item) =>
                      allExpanded ? next.delete(item.id) : next.add(item.id)
                    );
                    return next;
                  })
                }
              >
                <DsIcon
                  icon={allExpanded ? ChevronUp : ChevronDown}
                  recipe="main"
                />
                {allExpanded ? 'Fold all' : 'Expand all'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setComposerOpen((open) => !open)}
              >
                <DsIcon icon={Plus} recipe="main" /> New annotation
              </Button>
              <Button variant="secondary" size="sm" disabled>
                Convert
              </Button>
            </div>
          </div>
          <div className="proto-panel-scroll scrollbar-always-visible">
            {composerOpen ? (
              <section className="proto-composer">
                <div className="proto-composer-head">
                  <strong>New annotation</strong>
                  <Button
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    aria-label="Close new annotation"
                    onClick={() => setComposerOpen(false)}
                  >
                    <DsIcon icon={X} recipe="main" />
                  </Button>
                </div>
                <Textarea
                  variant="outlined"
                  size="sm"
                  rows={3}
                  autoFocus
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add a comment…"
                />
                <div className="proto-composer-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!comment.trim()}
                    onClick={save}
                  >
                    Save comment
                  </Button>
                </div>
              </section>
            ) : null}
            <ActiveVariant
              key={`${active}-${mountKey}`}
              items={items}
              expanded={expanded}
              onToggle={toggle}
              onViewSource={setSelectedSource}
            />
          </div>
        </aside>
      </div>
      {selectedSource ? (
        <div
          className="proto-source-overlay"
          onClick={() => setSelectedSource(null)}
        >
          <div
            className="proto-source-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Selected work"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="proto-composer-head">
              <strong>{selectedSource.context}</strong>
              <Button
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                aria-label="Close selected work"
                onClick={() => setSelectedSource(null)}
              >
                <DsIcon icon={X} recipe="main" />
              </Button>
            </div>
            <span>{selectedSource.detail}</span>
            <blockquote>{selectedSource.quote}</blockquote>
          </div>
        </div>
      ) : null}
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
