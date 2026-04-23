# Eigent - Plano de Melhorias Completo

> Análise: 231 arquivos TS/TSX | 54.674 linhas de código | 27 testes (baixa cobertura ~5%)

---

## 1. QUALIDADE DE CÓDIGO

### 1.1 Refatoração de Arquivos Críticos

| Arquivo | Linhas | Problema | Ação |
|---------|--------|----------|------|
| `chatStore.ts` | 3613 | **CRÍTICO** - Monolítico, impossível de manter | Extrair: messageHandlers, connectionManager, taskQueue |
| `Models.tsx` | 2100 | Componente gigante com 33 imports | Separar em: ModelList, ModelCard, ModelConfig |
| `DynamicTriggerConfig.tsx` | 1211 | Lógica condicional complexa (128 branches) | Extrair hook `useTriggerConfig` |
| `Folder/index.tsx` | 1253 | Responsabilidade única violada | Separar: FileTree, FolderContext, DragDrop |

### 1.2 Metricas de Código

```typescript
// PROBLEMAS IDENTIFICADOS:
// - 23 arquivos > 500 linhas (limite ideal: 200-300)
// - chatStore.ts com 252 branches (complexidade crítica)
// - 74 diretórios sem testes
```

**Ações Recomendadas:**
- [ ] Adicionar ESLint rule: `max-lines-per-function: [error, 200]`
- [ ] Configurar `complexity` ESLint plugin
- [ ] Implementar `pre-commit` hook para size checks
- [ ] Adicionar `dependency-cruiser` para detectar circular deps

### 1.3 TypeScript Improvements

- [ ] Migrar de `any` para tipos específicos (especialmente em `chatStore.ts`)
- [ ] Adicionar `strict: true` no tsconfig.json
- [ ] Criar types compartilhados em `src/types/`
- [ ] Usar `satisfies` operator para validar configurações

---

## 2. TESTES

### 2.1 Cobertura Atual: ~5%

```
PROBLEMA: 74 diretórios sem nenhum teste
CRÍTICO: chatStore.ts (3613 linhas) com apenas 1 arquivo de teste
```

### 2.2 Plano de Testes

| Prioridade | Área | Cobertura Atual | Meta |
|------------|------|-----------------|------|
| 🔴 CRÍTICA | chatStore | ~3% | 80% |
| 🔴 CRÍTICA | API Layer | 0% | 70% |
| 🟡 ALTA | Stores (zustand) | ~15% | 80% |
| 🟡 ALTA | Components UI | ~10% | 60% |
| 🟢 MÉDIA | Hooks | 0% | 70% |
| 🟢 MÉDIA | Utils | ~40% | 90% |

### 2.3 Estrutura de Testes Sugerida

```
test/
├── unit/
│   ├── components/      # ✓ existente
│   ├── stores/          # ✓ existente
│   ├── hooks/           # NOVO
│   └── utils/           # ✓ existente
├── integration/         # ✓ existente
│   ├── api/             # NOVO
│   └── workflow/        # NOVO
├── e2e/                 # existente mas vazio
│   ├── auth.spec.ts     # NOVO
│   ├── agent.spec.ts    # NOVO
│   └── workflow.spec.ts # NOVO
└── performance/         # existente mas vazio
    └── load.spec.ts     # NOVO
```

---

## 3. SEGURANÇA

### 3.1 Auditoria de Dependências

```bash
# Scripts de segurança sugeridos
npm audit --audit-level=high
npm outdated
snyk test
```

### 3.2 Issues Identificados

| Severity | Dependência | Versão Atual | Ação |
|----------|-------------|--------------|------|
| HIGH | `dompurify` | 3.2.7 | Verificar XSS vectors |
| MEDIUM | `marked` | 17.0.1 | Atualizar para 17.0.2+ |
| MEDIUM | `axios` | 1.9.0 | Verificar SSRF vectors |

### 3.3 Hardening de Código

- [ ] Sanitizar TODAS as inputs de usuário em `ChatBox`
- [ ] Implementar CSP headers no Electron
- [ ] Adicionar `Content-Security-Policy` meta tag
- [ ] Hardening de eval/Function em `chatStore.ts`
- [ ] Validar todas as URLs em MCP connector
- [ ] Implementar rate limiting no IPC do Electron

### 3.4 Segurança de API

- [ ] Adicionar `helmet` middleware
- [ ] Implementar CORS corretamente
- [ ] Adicionar request validation (zod)
- [ ] Implementar refresh tokens (verificar server/)

---

## 4. UI/UX

### 4.1 Acessibilidade (a11y)

| Componente | Issue | WCAG |
|------------|-------|------|
| ChatBox | Sem ARIA labels | AA |
| Button | Contraste insuficiente | AA |
| Modal | Focus trap incompleto | AA |
| Workflow | Sem keyboard nav | AA |

**Ações:**
- [ ] Audit com `axe-core`
- [ ] Adicionar `aria-*` labels em todos os componentes interativos
- [ ] Implementar skip links
- [ ] Adicionar `prefers-reduced-motion` support

### 4.2 Responsividade

- [ ] Mobile layout para componentes principais
- [ ] Testar em viewports: 320px, 768px, 1024px, 1440px
- [ ] Implementar `clsx` para classes responsivas

### 4.3 Performance Visual

- [ ] Virtualizar listas > 100 items (react-virtual)
- [ ] Lazy loading de imagens
- [ ] Skeleton loaders para estados de loading
- [ ] Debounce em inputs de busca

### 4.4 Melhorias de UX

| Área | Problema | Solução |
|------|----------|---------|
| Chat | Sem preview de mensagem | Adicionar typing indicator |
| Agent | Sem status visual | Badge de status online/offline |
| Workflow | Sem autosave | Salvar automaticamente |
| History | Sem busca | Adicionar fuzzy search |
| Settings | Muitas opções | Wizard de setup |

---

## 5. NOVAS FEATURES

### 5.1 Alta Prioridade

| Feature | Complexidade | Impacto | Similar em |
|---------|--------------|---------|------------|
| **Multi-tab Agent Chat** | Média | Alto | ChatGPT |
| **Agent Templates Marketplace** | Alta | Muito Alto | LangChain HUB |
| **Visual Workflow Debugger** | Alta | Alto | n8n |
| **Keyboard Shortcuts** | Baixa | Médio | Claude |
| **Dark/Light Mode Toggle** | Baixa | Médio | - |
| **Export Chat History** | Baixa | Médio | - |

### 5.2 Média Prioridade

| Feature | Complexidade | Impacto |
|---------|--------------|--------|
| **Team Collaboration** | Alta | Muito Alto |
| **Plugin System** | Alta | Alto |
| **Custom Agent Roles** | Média | Alto |
| **Scheduled Tasks Dashboard** | Média | Médio |
| **Agent Performance Analytics** | Média | Médio |
| **Voice Input** | Alta | Médio |

### 5.3 Community Requests

```markdown
# Top Feature Requests (baseado em issues do GitHub)
1. [P0]离线模式 - Modo offline completo
2. [P0]自定义模型支持 - Suporte a mais modelos locais
3. [P1]插件系统 - Plugin system
4. [P1]API REST - API para integrações externas
5. [P2]移动端 - Interface mobile
```

---

## 6. PERFORMANCE

### 6.1 Bundle Analysis

```
PROBLEMA: 231 arquivos = bundle potencialmente grande
```

**Ações:**
- [ ] Analisar bundle com `vite-bundle-analyzer`
- [ ] Code splitting por rota
- [ ] Dynamic imports para componentes pesados
- [ ] Tree shaking otimizado

### 6.2 Runtime Performance

| Componente | Issue | Solução |
|------------|-------|---------|
| chatStore | 3613 linhas | Lazy initialization |
| ChatBox | Re-renders excessivos | React.memo + useMemo |
| Folder | File tree lento | Virtual scrolling |
| Workflow | Canvas laggy | Canvas/WebGL optimization |

### 6.3 Backend Performance

- [ ] Adicionar caching (Redis) no server
- [ ] Implementar pagination no history
- [ ] Adicionar database indexes
- [ ] Connection pooling otimizado

---

## 7. DEVOPS & CI/CD

### 7.1 GitHub Actions - Melhorias

**Atual:**
- ✓ CI on PR
- ✓ CodeQL
- ✓ Lint markdown

**Falta:**
- [ ] Test coverage gate (falhar se < 50%)
- [ ] Bundle size check
- [ ] Dependency audit automation
- [ ] Performance regression detection
- [ ] e2e tests on PR
- [ ] Auto-preview deployments

### 7.2 Docker/Build

- [ ] Multi-stage Dockerfile para produção
- [ ] Build caching otimizado
- [ ] SBOM generation
- [ ] Reproducible builds

---

## 8. DOCUMENTAÇÃO

### 8.1 Gaps Identificados

| Área | Status | Ação |
|------|--------|------|
| README | ✓ Bom | Manter |
| CONTRIBUTING | ⚠️ Básico | Expandir com exemplos |
| API Docs | ❌ Falta | Adicionar OpenAPI/Swagger |
| Architecture | ⚠️ Parcial | Criar ADR + diagramas |
| Changelog | ❌ Falta | Adicionar auto-changelog |

### 8.2 Docs Suggestions

```
docs/
├── architecture/
│   ├── SYSTEM_OVERVIEW.md
│   ├── ADR-001-use-zustand.md
│   └── ADR-002-mcp-integration.md
├── api/
│   └── openapi.yaml
├── guides/
│   ├── PLUGIN_DEVELOPMENT.md
│   └── CUSTOM_AGENT.md
└── troubleshooting/
    └── PERFORMANCE.md
```

---

## 9. MONITORING & TELEMETRY

### 9.1 Erro Tracking

- [ ] Integrar Sentry ou similar
- [ ] Custom error boundaries
- [ ] Error reporting no Electron

### 9.2 Analytics

- [ ] Feature flags (Unleash/Flagsmith)
- [ ] Usage analytics (PostHog/Plausible)
- [ ] Agent performance metrics

### 9.3 Observabilidade

- [ ] Structured logging
- [ ] APM integration
- [ ] Health check endpoints

---

## ROADMAP PRIORIZADO

### Fase 1: Fundacionais (Semanas 1-4)

```
1. [TESTES] Atingir 50% cobertura em chatStore
2. [QUALIDADE] Refatorar chatStore.ts (extrair 3 módulos)
3. [SEGURANÇA] Audit de XSS + CSP implementation
4. [PERF] Bundle analysis + code splitting
```

### Fase 2: UI/UX (Semanas 5-8)

```
1. [A11Y] Audit WCAG + ARIA implementation
2. [A11Y] Keyboard navigation completa
3. [UX] Loading states + skeleton screens
4. [UX] Dark/Light mode
```

### Fase 3: Features (Semanas 9-16)

```
1. [FEATURE] Keyboard shortcuts
2. [FEATURE] Agent templates
3. [FEATURE] Export chat history
4. [FEATURE] Multi-tab chat
```

### Fase 4: Infra (Semanas 17-20)

```
1. [DEVOPS] Coverage gate in CI
2. [DEVOPS] Auto-changelog
3. [DOCS] API docs + Architecture docs
4. [MONITORING] Sentry integration
```

---

## QUICK WINS (Implementar em 1 dia)

1. Adicionar `.env.example` com todas as vars
2. Criar `CONTRIBUTING.md` com setup instructions
3. Adicionar `dependabot.yml` para auto-updates
4. Implementar `sonar-project.properties`
5. Adicionar badges de coverage no README

---

*Documento gerado: $(date)*
*Total de issues identificadas: 45+*
