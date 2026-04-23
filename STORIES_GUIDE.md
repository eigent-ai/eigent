# Stories - Implementação step-by-step

## QUICK WINS (Iniciar aqui - 1 dia cada)

---

### QW-1: `.env.example`
**File:** `.env.example`

```bash
# cp .env.example .env
```

```env
# Backend API
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001

# Auth (se aplicável)
VITE_AUTH_ENABLED=false
VITE_AUTH_PROVIDER=

# Features
VITE_ENABLE_TELEMETRY=false
VITE_DEBUG_MODE=false

# Build
VITE_APP_VERSION=${npm_package_version}
```

---

### QW-2: Coverage Badge
**File:** `README.md`

Adicionar ao README:
```markdown
[![Coverage](https://img.shields.io/codecov/c/github/Akasha-0/eigent)](https://codecov.io/gh/Akasha-0/eigent)
```

Vitest config:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/'],
    },
  },
})
```

---

### QW-3: React.lazy Monaco
**File:** `src/components/MonacoLoader.tsx`

```tsx
import { lazy, Suspense } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

export function MonacoLoader({ ...props }) {
  return (
    <Suspense fallback={<div className="skeleton monaco-skeleton" />}>
      <MonacoEditor {...props} />
    </Suspense>
  );
}
```

---

### QW-4: useKeyboardShortcut
**File:** `src/hooks/useKeyboardShortcut.ts`

```typescript
import { useEffect, useCallback } from 'react';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
}

export function useKeyboardShortcut(shortcuts: Shortcut[]) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      const match = 
        e.key.toLowerCase() === shortcut.key.toLowerCase() &&
        !!shortcut.ctrl === (e.ctrlKey || e.metaKey) &&
        !!shortcut.shift === e.shiftKey &&
        !!shortcut.alt === e.altKey;
      
      if (match) {
        e.preventDefault();
        shortcut.action();
      }
    }
  }, [shortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

---

### QW-5: aria-label Audit
```bash
# Encontrar botões sem aria-label
grep -rn "<button" src --include="*.tsx" -A 1 | grep -v "aria-label" | grep -v "</button>"
```

---

### QW-6: npm audit
```bash
npm audit
npm audit fix
npm audit fix --force  # se necessario
```

---

## ÉPICO 3: UI/UX

### 3.1: Keyboard Shortcuts Completos (8 pts)
```typescript
// src/hooks/useKeyboardShortcut.ts
const shortcuts = [
  { key: 's', ctrl: true, action: save },
  { key: 'n', ctrl: true, action: newTask },
  { key: 'k', ctrl: true, action: search },
  { key: 'w', ctrl: true, action: closeTab },
  { key: '/', action: focusSearch },
];

useKeyboardShortcut(shortcuts);
```

### 3.2: Dark/Light Mode (8 pts)
```typescript
// src/contexts/ThemeContext.tsx
type Theme = 'light' | 'dark' | 'system';

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useLocalStorage('theme', 'system');
  
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    
    if (theme === 'system') {
      root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } else {
      root.classList.add(theme);
    }
  }, [theme]);
  
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
```

### 3.3: Loading States (5 pts)
```tsx
// src/components/Skeleton.tsx
export function Skeleton({ width, height, className }: SkeletonProps) {
  return <div className={cn('skeleton', className)} style={{ width, height }} />;
}

// src/components/Spinner.tsx
export function Spinner({ size = 24 }: SpinnerProps) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}
```

---

## ÉPICO 4: Security

### 4.1: XSS Audit (8 pts)
```typescript
// src/utils/sanitize.ts
import DOMPurify from 'dompurify';

export function sanitizeHTML(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'target', 'class'],
  });
}

// Audit: grep -rn "innerHTML\|dangerouslySetInnerHTML" src --include="*.tsx"
```

### 4.2: CSP Headers (5 pts)
```html
<!-- index.html -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' ws://localhost:*;
">
```

### 4.3: Rate Limiting (5 pts)
```typescript
// electron/preload/rateLimiter.ts
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, max: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(key);
  
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
```

---

## ÉPICO 5: Performance

### 5.1: Lazy Routes (8 pts)
```typescript
// src/App.tsx
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Agents = lazy(() => import('./pages/Agents'));

function App() {
  return (
    <Routes>
      <Route path="/" element={<Suspense fallback={<Loading />}><Dashboard /></Suspense>} />
      <Route path="/settings" element={<Suspense fallback={<Loading />}><Settings /></Suspense>} />
    </Routes>
  );
}
```

### 5.2: Bundle Analysis (5 pts)
```bash
npm install --save-dev rollup-plugin-visualizer
```

```typescript
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';

export default {
  plugins: [
    vue(),
    visualizer({ filename: 'bundle-stats.html' }),
  ],
}
```

### 5.3: Virtual Scrolling (13 pts)
```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList({ items }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => (
          <div key={virtual.key} style={{ position: 'absolute', top: virtual.start }}>
            <Item data={items[virtual.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## ÉPICO 6: Documentation

### 6.1: Architecture Docs (5 pts)
```markdown
# Architecture

## Overview
Eigent is a multi-agent desktop application built with Electron + React.

## Component Hierarchy
```
App
├── Sidebar
│   ├── ProjectTree
│   └── AgentList
├── MainContent
│   ├── ChatPanel
│   │   ├── MessageList (virtualized)
│   │   └── InputArea
│   └── AgentWorkspace
└── Settings
```

## Data Flow
1. User Input → React Components
2. → IPC Bridge (preload)
3. → Main Process (Electron)
4. → Backend API / Agents
```

---

## Checklist de Implementação

### Iniciar projeto:
```bash
cd ~/eigent
git checkout -b feature/quick-wins
```

### Para cada QW:
```bash
# Criar branch
git checkout -b feature/QW-1-env-example

# Implementar
# ... código ...

# Commit
git add .
git commit -m "QW-1: Add .env.example"

# Push + PR
git push -u origin feature/QW-1-env-example
gh pr create --title "QW-1: .env.example" --body "Quick win 1: Security"
```

### Ordem sugerida:
1. QW-1 (Security)
2. QW-6 (Security)
3. QW-4 (UI/UX)
4. QW-3 (Performance)
5. QW-5 (UI/UX)
6. QW-2 (Docs)
7. Continue com épicos...
