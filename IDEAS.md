# Feature Ideas - Akasha-0/eigent

> Gerado por Hermes Agent Ideation Skill
> Data: 2026-04-23

---

## Resumo Executivo

| Métrica | Valor |
|---------|-------|
| Arquivos TS/TSX | 399 |
| Linhas de código | 102,385 |
| Arquivos > 500 linhas | 23 |
| Testes existentes | 21 |
| Cobertura estimada | ~5% |
| Componentes com aria-labels | 17 |

---

## 🎯 Code Quality

| Ideia | Impacto | Esforço | Prioridade |
|-------|---------|---------|------------|
| Continuar extração handlers (Story 1.5+) | High | Medium | P0 |
| Aumentar cobertura de testes para 80% | High | High | P0 |
| Reduzir chatStore.ts (3,575 → <500 linhas) | High | Medium | P1 |
| Reduzir electron/main/index.ts (3,637 → módulos) | High | High | P1 |
| Configurar ESLint strict mode | Medium | Low | P1 |
| Adicionar Prettier + Husky pre-commit | Medium | Low | P2 |
| Criar scripts de refatoração automática | Medium | Medium | P2 |

### Quick Wins - Code Quality
1. `npm run lint -- --max-warnings=0` → fail on warnings
2. Adicionar `tsc --strict` no CI
3. Configurar `import/order` no ESLint

---

## 🎨 UI/UX

| Ideia | Impacto | Esforço | Prioridade |
|-------|---------|---------|------------|
| Adicionar keyboard shortcuts globais | High | Low | P0 |
| Implementar dark/light mode toggle | High | Medium | P1 |
| Melhorar loading states e skeletons | High | Medium | P1 |
| Adicionar wizard de onboarding | Medium | High | P1 |
| Implementar notifications in-app | Medium | Medium | P2 |
| Adicionar tooltips explicativos | Medium | Low | P2 |
| Melhorar empty states com ilustrações | Low | Low | P3 |

### Quick Wins - UI/UX
1. Adicionar `aria-label` em todos os botões
2. Implementar `useKeyboardShortcut` hook
3. Adicionar loading spinner global

---

## 📚 Documentation

| Ideia | Impacto | Esforço | Prioridade |
|-------|---------|---------|------------|
| Adicionar architecture diagram no README | High | Low | P0 |
| Criar API documentation (OpenAPI/Swagger) | High | High | P1 |
| Escrever migration guide para v0.1 → v1.0 | Medium | Medium | P1 |
| Criar CONTRIBUTING.md detalhado | Medium | Low | P1 |
| Adicionar examples folder com demos | Medium | Medium | P2 |
| Documentar ambiente de desenvolvimento | Medium | Low | P2 |

### Quick Wins - Documentation
1. `.env.example` - criar arquivo com variáveis necessárias
2. Adicionar badges: coverage, license, version
3. Tutorial de 5 min no README

---

## 🔒 Security

| Ideia | Impacto | Esforço | Prioridade |
|-------|---------|---------|------------|
| Adicionar `.env.example` | High | Low | P0 |
| Implementar rate limiting no IPC | High | Medium | P1 |
| Audit XSS vectors em dompurify usage | High | Medium | P1 |
| Configurar CSP headers strict | High | Medium | P1 |
| Adicionar CORS validation | Medium | Low | P2 |
| Implementar input sanitization centralizada | Medium | Medium | P2 |
| Adicionar security.txt/.well-known/security | Low | Low | P3 |

### Quick Wins - Security
1. `cp .env.example .env` - criar template
2. `npm audit fix` - corrigir vulnerabilidades
3. Adicionar CSP report-uri

---

## ⚡ Performance

| Ideia | Impacto | Esforço | Prioridade |
|-------|---------|---------|------------|
| Lazy load routes com React.lazy | High | Medium | P0 |
| Code split heavy components (Monaco, XTerm) | High | Medium | P1 |
| Implementar virtual scrolling em listas | High | Medium | P1 |
| Otimizar bundle size (tree shaking) | Medium | Medium | P1 |
| Adicionar service worker para offline | Medium | High | P2 |
| Implementar React.memo em componentes | Medium | Low | P2 |
| Cache de módulos com dynamic imports | Medium | Medium | P2 |

### Quick Wins - Performance
1. `React.lazy(() => import('./HeavyComponent'))`
2. `const Monaco = lazy(() => import('@monaco-editor/react'))`
3. Adicionar `loading.tsx` para suspense boundaries

---

## 🏆 Quick Wins (1 dia)

| # | Ideia | Área |
|---|-------|------|
| 1 | Criar `.env.example` | Security |
| 2 | Adicionar coverage badge | Docs |
| 3 | React.lazy para Monaco Editor | Performance |
| 4 | Keyboard shortcuts hook | UI/UX |
| 5 | aria-label em botões | UI/UX |
| 6 | `npm audit fix` | Security |

---

## 📋 Próximos Épicos Sugeridos

### Épico 3: UI/UX Polish
- Story 3.1: Keyboard Shortcuts (8 pts)
- Story 3.2: Dark/Light Mode (8 pts)
- Story 3.3: Loading States (5 pts)

### Épico 4: Security Hardening  
- Story 4.1: XSS Audit + Fix (8 pts)
- Story 4.2: CSP Headers (5 pts)
- Story 4.3: Rate Limiting (5 pts)

### Épico 5: Performance Optimization
- Story 5.1: Lazy Loading Routes (8 pts)
- Story 5.2: Bundle Analysis (5 pts)
- Story 5.3: Virtual Scrolling (13 pts)

---

## 🚀 Quer implementar?

1. **Implementar quick win** - Escolha um da lista acima
2. **Criar epic/stories** - Gero o planejamento completo
3. **Começar por** - Code Quality, UI/UX, Security ou Performance?
