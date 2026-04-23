# Épicos e Stories - Implementação Akasha-0/eigent

> Gerado por Hermes Agent - Baseado em IDEAS.md
> Data: 2026-04-23

---

## QUICK WINS (1 dia cada - iniciar aqui)

---

### QW-1: Criar `.env.example`
**Área:** Security | **Esforço:** 1h | **Prioridade:** P0

**Tasks:**
- [ ] Identificar todas variáveis de ambiente usadas
- [ ] Criar `.env.example` com valores placeholder
- [ ] Adicionar ao `.gitignore`
- [ ] Documentar no README

**Arquivos:**
- `.env.example`
- `.gitignore` (update)
- `README.md` (update)

---

### QW-2: Coverage Badge
**Área:** Documentation | **Esforço:** 2h | **Prioridade:** P1

**Tasks:**
- [ ] Configurar coverage output JSON em vitest.config.ts
- [ ] Adicionar coverage badge no README (shields.io)
- [ ] Adicionar badges: license, version, build

**Arquivos:**
- `vitest.config.ts` (update)
- `README.md` (update)

---

### QW-3: React.lazy para Monaco Editor
**Área:** Performance | **Esforço:** 4h | **Prioridade:** P0

**Tasks:**
- [ ] Identificar onde Monaco é importado
- [ ] Criar componente wrapper com React.lazy
- [ ] Adicionar Suspense boundary com skeleton
- [ ] Testar em desenvolvimento e produção

**Arquivos:**
- `src/components/MonacoEditor/` (novo)
- `src/components/CodeEditor/` (update)

---

### QW-4: Keyboard Shortcuts Hook
**Área:** UI/UX | **Esforço:** 3h | **Prioridade:** P0

**Tasks:**
- [ ] Criar `src/hooks/useKeyboardShortcut.ts`
- [ ] Definir atalhos globais (Ctrl+S, Ctrl+N, etc)
- [ ] Integrar com componentes principais
- [ ] Adicionar visual hint para atalhos

**Arquivos:**
- `src/hooks/useKeyboardShortcut.ts` (novo)
- `src/components/` (update)

---

### QW-5: aria-label em Botões
**Área:** UI/UX | **Esforço:** 4h | **Prioridade:** P1

**Tasks:**
- [ ] Audit todos os botões sem aria-label
- [ ] Adicionar labels descritivos
- [ ] Verificar contraste WCAG AA

**Comandos:**
```bash
grep -rn "<button" src --include="*.tsx" | grep -v "aria-label"
```

---

### QW-6: npm audit fix
**Área:** Security | **Esforço:** 1h | **Prioridade:** P0

**Tasks:**
- [ ] `npm audit`
- [ ] `npm audit fix`
- [ ] Verificar breaking changes
- [ ] Commit mudanças

**Comandos:**
```bash
npm audit
npm audit fix --force  # se necessário
```

---

## ÉPICO 3: UI/UX Polish
**Impacto:** Alto | **Estimativa:** 2 semanas

---

### Story 3.1: Keyboard Shortcuts Completos
**Pontos:** 8 | **Prioridade:** P0

**Descrição:** Sistema completo de atalhos de teclado

**Critérios de Aceitação:**
```
[ ] Hook useKeyboardShortcut
[ ] Atalhos: Ctrl+S (save), Ctrl+N (new), Ctrl+K (search)
[ ] Visual hints na UI
[ ] Documentação de atalhos
```

**Tasks:**
- [ ] useKeyboardShortcut hook
- [ ] GlobalKeyboardShortcuts component
- [ ] Shortcuts documentation modal
- [ ] Testes unitários

---

### Story 3.2: Dark/Light Mode
**Pontos:** 8 | **Prioridade:** P1

**Descrição:** Toggle de tema com persistência

**Critérios de Aceitação:**
```
[ ] Toggle no header/settings
[ ] Persistência em localStorage
[ ] Respeitar prefers-color-scheme
[ ] Transições suaves
```

**Tasks:**
- [ ] ThemeProvider setup
- [ ] CSS variables para cores
- [ ] Toggle component
- [ ] Persistência
- [ ] Testes

---

### Story 3.3: Loading States
**Pontos:** 5 | **Prioridade:** P1

**Descrição:** Skeletons e spinners consistentes

**Critérios de Aceitação:**
```
[ ] Skeleton component reutilizável
[ ] Loading states em todas telas
[ ] Spinner global
[ ] Timeout handling
```

**Tasks:**
- [ ] Skeleton component
- [ ] Spinner component
- [ ] LoadingProvider context
- [ ] Integration em telas

---

### Story 3.4: Empty States
**Pontos:** 3 | **Prioridade:** P2

**Descrição:** Ilustrações e CTAs para empty states

**Tasks:**
- [ ] EmptyState component
- [ ] Ilustrações placeholder
- [ ] CTAs contextuais

---

## ÉPICO 4: Security Hardening
**Impacto:** Crítico | **Estimativa:** 2 semanas

---

### Story 4.1: XSS Audit
**Pontos:** 8 | **Prioridade:** P0

**Descrição:** Audit e correção de vulnerabilidades XSS

**Critérios de Aceitação:**
```
[ ] Audit completo em dompurify usage
[ ] Sanitização de inputs
[ ] CSP headers configurados
[ ] Testes de XSS
```

**Tasks:**
- [ ] Mapear todos DOMPurify usages
- [ ] Verificar allowlist configs
- [ ] Testes de fuzzing básicos
- [ ] Documentar findings

---

### Story 4.2: CSP Headers
**Pontos:** 5 | **Prioridade:** P0

**Descrição:** Content Security Policy estrita

**Critérios de Aceitação:**
```
[ ] CSP meta tag ou header
[ ] Directives mínimos necessários
[ ] Report-uri configurado
[ ] Teste em staging
```

**Tasks:**
- [ ] Definir política CSP
- [ ] Implementar meta tag
- [ ] Configurar report-uri
- [ ] Testar compatibilidade

---

### Story 4.3: Rate Limiting
**Pontos:** 5 | **Prioridade:** P1

**Descrição:** Limitar requests no IPC bridge

**Tasks:**
- [ ] Identificar IPC endpoints críticos
- [ ] Implementar rate limiter
- [ ] UI feedback para rate limit
- [ ] Testes de carga

---

### Story 4.4: Input Validation Centralizada
**Pontos:** 5 | **Prioridade:** P1

**Descrição:** Zod schemas para validação

**Tasks:**
- [ ] Setup Zod
- [ ] Criar schemas para inputs
- [ ] Middleware de validação
- [ ] Error handling centralizado

---

## ÉPICO 5: Performance Optimization
**Impacto:** Alto | **Estimativa:** 3 semanas

---

### Story 5.1: Lazy Loading Routes
**Pontos:** 8 | **Prioridade:** P0

**Descrição:** Code splitting em todas rotas

**Critérios de Aceitação:**
```
[ ] React.lazy em todas rotas
[ ] Suspense boundaries
[ ] Loading states
[ ] Prefetching estratégico
```

**Tasks:**
- [ ] Audit de imports estáticos
- [ ] Implementar lazy routes
- [ ] Suspense boundaries
- [ ] Prefetch config

---

### Story 5.2: Bundle Analysis
**Pontos:** 5 | **Prioridade:** P0

**Descrição:** Analisar e otimizar bundle

**Tasks:**
- [ ] Setup bundle analyzer
- [ ] Identificar largest chunks
- [ ] Tree shaking optimization
- [ ] Dependency cleanup

---

### Story 5.3: Virtual Scrolling
**Pontos:** 13 | **Prioridade:** P1

**Descrição:** Listas virtuais para grandes datasets

**Tasks:**
- [ ] Avaliar react-window vs react-virtuoso
- [ ] Implementar em MessageList
- [ ] Implementar em FileTree
- [ ] Performance testing

---

### Story 5.4: Service Worker
**Pontos:** 8 | **Prioridade:** P2

**Descrição:** Offline support e caching

**Tasks:**
- [ ] Workbox setup
- [ ] Cache strategies
- [ ] Offline fallback UI
- [ ] Background sync

---

## ÉPICO 6: Documentation
**Impacto:** Médio | **Estimativa:** 1 semana

---

### Story 6.1: Architecture Docs
**Pontos:** 5 | **Prioridade:** P0

**Tasks:**
- [ ] Architecture diagram (Mermaid)
- [ ] Component hierarchy doc
- [ ] Data flow doc
- [ ] README update

---

### Story 6.2: API Documentation
**Pontos:** 8 | **Prioridade:** P1

**Tasks:**
- [ ] OpenAPI/Swagger setup
- [ ] Document IPC endpoints
- [ ] Document main processes
- [ ] Interactive docs

---

### Story 6.3: Migration Guide
**Pontos:** 3 | **Prioridade:** P2

**Tasks:**
- [ ] Changelog format
- [ ] Breaking changes doc
- [ ] Upgrade instructions

---

## ÉPICO 7: Code Quality
**Impacto:** Crítico | **Estimativa:** 4 semanas

---

### Story 7.1: ESLint Strict
**Pontos:** 3 | **Prioridade:** P1

**Tasks:**
- [ ] Enable strict rules
- [ ] Fix all warnings
- [ ] CI enforcement

---

### Story 7.2: Refatorar chatStore
**Pontos:** 13 | **Prioridade:** P0

**Tasks:**
- [ ] Continuar extração handlers
- [ ] Reduzir para <500 linhas
- [ ] Tests >80%

---

### Story 7.3: Test Coverage 80%
**Pontos:** 13 | **Prioridade:** P0

**Tasks:**
- [ ] Setup coverage CI gate
- [ ] Coverage por módulo
- [ ] Critical paths coverage
- [ ] E2E tests

---

## Timeline Sugerido

```
Semana 1-2: Quick Wins (6 items)
Semana 3-4: Épico 4 (Security) + QW-1
Semana 5-6: Épico 3 (UI/UX) + QW-4
Semana 7-9: Épico 5 (Performance)
Semana 10-12: Épico 6 (Docs) + Épico 7 (Code Quality)
```

---

## Definition of Done

Para cada story:
```
[ ] Código implementado
[ ] Testes passando
[ ] TypeScript strict passing
[ ] ESLint passing
[ ] PR approved + merged
[ ] Documentation updated
```

---

## Métricas de Sucesso

| Antes | Depois |
|-------|--------|
| Coverage: ~5% | >80% |
| .env.example: ❌ | ✅ |
| XSS vectors: unknown | 0 |
| Bundle size: unknown | <500KB gzipped |
| aria-labels: 17 | 100% |
| chatStore: 3,575 linhas | <500 |
