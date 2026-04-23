# Eigent - Épicos e Stories de Implementação

> Plano de execução para melhorias críticas | Total estimado: ~12 semanas

---

# ÉPICO 1: REFATORAÇÃO DO CHATSTORE
**Impacto:** Crítico | **Estimativa:** 3 semanas

---

## STORY 1.1: Extrair MessageHandler Module
**Pontos:** 8 | **Prioridade:** P0 (Crítica)

### Descrição
Extrair toda a lógica de manipulação de mensagens do chatStore.ts para um módulo isolado `MessageHandler`.

### Critérios de Aceitação
```
[ ] Extração de métodos: addMessage, editMessage, deleteMessage, pinMessage
[ ] Criação de MessageHandler com interface pública clara
[ ] Preservar todos os tipos/schemas existentes
[ ] 100% backward compatibility
[ ] Cobertura de testes: 80%
```

### Tasks
- [ ] Criar `src/store/handlers/MessageHandler.ts`
- [ ] Definir interfaces `MessageInput`, `MessageUpdate`
- [ ] Migrar lógica de mensagens
- [ ] Atualizar imports no chatStore
- [ ] Escrever testes unitários
- [ ] Verificar lint e type-check

---

## STORY 1.2: Extrair ConnectionManager Module
**Pontos:** 8 | **Prioridade:** P0 (Crítica)

### Descrição
Extrair toda a lógica de conexão WebSocket/streaming do chatStore para um módulo isolado.

### Critérios de Aceitação
```
[ ] Extração de: connect, disconnect, reconnect, handleStream
[ ] Interface para event emitters
[ ] Error handling centralizado
[ ] Cobertura de testes: 80%
```

### Tasks
- [ ] Criar `src/store/handlers/ConnectionManager.ts`
- [ ] Definir tipos de eventos (connection, message, error, close)
- [ ] Implementar retry logic com exponential backoff
- [ ] Migrar lógica existente
- [ ] Escrever testes de conexão
- [ ] Teste de reconnect automático

---

## STORY 1.3: Extrair TaskQueue Module
**Pontos:** 5 | **Prioridade:** P0 (Crítica)

### Descrição
Extrair a fila de tarefas/fila de execução para módulo separado.

### Critérios de Aceitação
```
[ ] Métodos: enqueue, dequeue, prioritize, cancel
[ ] Persistência de estado
[ ] Concurrent task limiting
[ ] Cobertura de testes: 80%
```

### Tasks
- [ ] Criar `src/store/handlers/TaskQueue.ts`
- [ ] Implementar PriorityQueue
- [ ] Adicionar task status tracking
- [ ] Migrar de chatStore
- [ ] Testes de concorrência

---

## STORY 1.4: Refatorar ChatStore Principal
**Pontos:** 13 | **Prioridade:** P0 (Crítica)

### Descrição
Converter chatStore em um orchestrator slim que delega para os módulos extraídos.

### Critérios de Aceitação
```
[ ] chatStore.ts < 500 linhas
[ ] Apenas selectors e actions thin
[ ] Imports de MessageHandler, ConnectionManager, TaskQueue
[ ] Sem lógica de negócio
[ ] TypeScript strict mode
[ ] Cobertura total: 80%
```

### Tasks
- [ ] Reescrever chatStore.ts como facade
- [ ] Criar store/index.ts para exports
- [ ] Atualizar todos os consumers
- [ ] Migration guide para outros devs
- [ ] Full test suite

---

## STORY 1.5: Cleanup de Tipos e Exports
**Pontos:** 3 | **Prioridade:** P1

### Descrição
Limpar tipos redundantes e organizar exports.

### Critérios de Aceitação
```
[ ] src/types/ reorganizado
[ ] No 'any' types
[ ] Barrel exports limpos
```

---

# ÉPICO 2: PIPELINE DE TESTES
**Impacto:** Crítico | **Estimativa:** 3 semanas

---

## STORY 2.1: Setup Test Infrastructure
**Pontos:** 5 | **Prioridade:** P0

### Descrição
Melhorar infraestrutura de testes para suportar cobertura adequada.

### Critérios de Aceitação
```
[ ] Vitest coverage > 50%
[ ] Coverage reports em HTML e JSON
[ ] GitHub Action com coverage gate
[ ] CI falhar se coverage < 50%
```

### Tasks
- [ ] Configurar vitest coverage thresholds
- [ ] Adicionar thresholds no vitest.config.ts
- [ ] Configurar GitHub Action coverage check
- [ ] Criar badge de coverage no README
- [ ] Setup SonarQube (opcional)

---

## STORY 2.2: Testes do MessageHandler
**Pontos:** 8 | **Prioridade:** P0

### Descrição
Escrever testes abrangentes para MessageHandler.

### Test Cases
```
[ ] addMessage: adiciona corretamente
[ ] addMessage: valida input
[ ] editMessage: atualiza existing
[ ] editMessage: falha em não existente
[ ] deleteMessage: remove corretamente
[ ] pinMessage: alterna pinned state
[ ] bulkOperations: atomicidade
```

---

## STORY 2.3: Testes do ConnectionManager
**Pontos:** 8 | **Prioridade:** P0

### Test Cases
```
[ ] connect: estabelece conexão
[ ] connect: retry em falha
[ ] disconnect: limpa recursos
[ ] reconnect: exponential backoff
[ ] handleStream: parse events
[ ] handleStream: erro em dados inválidos
[ ] cleanup: WebSocket garbage collection
```

---

## STORY 2.4: Testes do TaskQueue
**Pontos:** 5 | **Prioridade:** P0

### Test Cases
```
[ ] enqueue: adiciona à fila
[ ] dequeue: retorna mais antigo
[ ] prioritize: move para frente
[ ] cancel: remove task
[ ] concurrent: respeita limite
[ ] persist: recupera após reload
```

---

## STORY 2.5: Testes de Integração - Chat Flow
**Pontos:** 8 | **Prioridade:** P1

### Descrição
Testes de integração para fluxo completo de chat.

### Test Cases
```
[ ] User sends message -> message appears
[ ] Agent streams response -> rendered correctly
[ ] Message edit -> history updated
[ ] Message delete -> removed from view
[ ] Reconnection -> resumes state
```

---

# ÉPICO 3: SEGURANÇA
**Impacto:** Crítico | **Estimativa:** 2 semanas

---

## STORY 3.1: XSS Audit e Fix
**Pontos:** 8 | **Prioridade:** P0

### Descrição
Auditar e corrigir todas as vulnerabilidades XSS.

### Critérios de Aceitação
```
[ ] dompurify em TODAS as renderizações de HTML
[ ] Sem innerHTML perigoso
[ ] Sanitização de markdown renderizado
[ ] Sanitização de mensagens de agente
```

### Tasks
- [ ] Audit: grep por innerHTML, dangerouslySetInnerHTML
- [ ] Criar sanitizer utilitário
- [ ] Aplicar em ChatBox message rendering
- [ ] Aplicar em markdown rendering
- [ ] Testes de fuzzing XSS

---

## STORY 3.2: Content Security Policy
**Pontos:** 5 | **Prioridade:** P0

### Descrição
Implementar CSP headers no Electron.

### Critérios de Aceitação
```
[ ] CSP meta tag configurado
[ ] policy: default-src 'self'
[ ] script-src: nonce ou hash
[ ] object-src: 'none'
[ ] frame-ancestors: 'none'
```

### Tasks
- [ ] Criar CSP middleware
- [ ] Configurar em electron/main
- [ ] Testar em dev mode
- [ ] Documentar CSP exceptions

---

## STORY 3.3: Input Validation
**Pontos:** 5 | **Prioridade:** P1

### Descrição
Validar todas as inputs de usuário com Zod.

### Tasks
- [ ] Schema de validação para messages
- [ ] Schema para agent config
- [ ] Schema para MCP connectors
- [ ] Integrar com stores

---

## STORY 3.4: IPC Security Hardening
**Pontos:** 3 | **Prioridade:** P1

### Descrição
Proteger comunicação IPC do Electron.

### Tasks
- [ ] Whitelist de channels IPC
- [ ] Rate limiting por channel
- [ ] Input sanitization no preload

---

# ÉPICO 4: UI/UX ACESSIBILIDADE
**Impacto:** Alto | **Estimativa:** 2 semanas

---

## STORY 4.1: Audit WCAG + ARIA Implementation
**Pontos:** 8 | **Prioridade:** P1

### Descrição
Audit completo de acessibilidade e implementação de ARIA.

### Critérios de Aceitação
```
[ ] axe-core: 0 violações críticas
[ ] Todos os componentes interativos com aria-label
[ ] Focus management em modais
[ ] Skip links funcionais
[ ] Keyboard navigation completa
```

### Tasks
- [ ] Install axe-core no projeto
- [ ] Criar script de audit
- [ ] Fix ChatBox accessibility
- [ ] Fix Dialog/Modal accessibility
- [ ] Fix Workflow canvas accessibility
- [ ] Testar com screen reader

---

## STORY 4.2: Keyboard Navigation
**Pontos:** 5 | **Prioridade:** P1

### Descrição
Implementar navegação completa por teclado.

### Shortcuts a implementar
```
[ ] Ctrl+K: Global search
[ ] Ctrl+N: New chat
[ ] Ctrl+W: Close tab
[ ] Ctrl+Tab: Switch tabs
[ ] Escape: Close modal
[ ] /: Focus search
[ ] ?: Show shortcuts help
```

### Tasks
- [ ] Criar useKeyboardShortcuts hook
- [ ] Implementar global shortcuts
- [ ] Shortcut hints na UI
- [ ] Configurable shortcuts

---

## STORY 4.3: Loading States + Skeletons
**Pontos:** 5 | **Prioridade:** P2

### Descrição
Implementar estados de loading consistentes.

### Tasks
- [ ] Criar Skeleton component
- [ ] Apply em ChatBox
- [ ] Apply em Agent list
- [ ] Apply em Settings
- [ ] Consistent loading animation

---

# ÉPICO 5: PERFORMANCE
**Impacto:** Alto | **Estimativa:** 2 semanas

---

## STORY 5.1: Bundle Analysis + Code Splitting
**Pontos:** 8 | **Prioridade:** P1

### Descrição
Analisar e otimizar bundle do frontend.

### Critérios de Aceitação
```
[ ] Bundle < 2MB (gzipped)
[ ] Initial load < 3s
[ ] Route-based code splitting
[ ] Lazy loading de componentes pesados
```

### Tasks
- [ ] Install bundle analyzer
- [ ] Analyze vendor chunks
- [ ] Implement React.lazy para routes
- [ ] Split Monaco Editor
- [ ] Split workflow components
- [ ] Optimize images

---

## STORY 5.2: React Performance Optimization
**Pontos:** 5 | **Prioridade:** P1

### Descrição
Otimizar re-renders e performance runtime.

### Tasks
- [ ] Profile ChatBox with DevTools
- [ ] Add React.memo where needed
- [ ] Optimize useCallback/useMemo usage
- [ ] Virtual scrolling para long chats
- [ ] Debounce search inputs

---

## STORY 5.3: ChatStore Lazy Initialization
**Pontos:** 3 | **Prioridade:** P2

### Descrição
Lazy load do chatStore para melhorar initial load.

### Tasks
- [ ] Implement store hydration
- [ ] Defer non-critical state
- [ ] Measure improvement

---

# ÉPICO 6: DEVOPS / CI-CD
**Impacto:** Médio | **Estimativa:** 1 semana

---

## STORY 6.1: Coverage Gate in CI
**Pontos:** 3 | **Prioridade:** P0

### Descrição
Falhar CI se coverage < 50%.

### Tasks
- [ ] Update GitHub Action
- [ ] Add coverage threshold
- [ ] PR blocking if fails
- [ ] Badge no README

---

## STORY 6.2: Dependency Updates Automation
**Pontos:** 3 | **Prioridade:** P1

### Descrição
Configurar dependabot para updates automáticos.

### Tasks
- [ ] Create dependabot.yml
- [ ] Configure npm updates
- [ ] Configure GitHub Actions updates
- [ ] Set security-only for major

---

## STORY 6.3: Auto Changelog
**Pontos:** 2 | **Prioridade:** P2

### Descrição
Gerar changelog automaticamente.

### Tasks
- [ ] Setup standard-version
- [ ] Configure conventional commits
- [ ] CHANGELOG.md generation

---

# ÉPICO 7: DOCUMENTAÇÃO
**Impacto:** Médio | **Estimativa:** 1 semana

---

## STORY 7.1: Architecture Documentation
**Pontos:** 5 | **Prioridade:** P1

### Descrição
Criar documentação de arquitetura.

### Deliverables
```
[ ] SYSTEM_OVERVIEW.md
[ ] ADR-001-zustand-usage.md
[ ] ADR-002-mcp-integration.md
[ ] Store architecture diagram
[ ] Component hierarchy diagram
```

---

## STORY 7.2: CONTRIBUTING Guide Enhancement
**Pontos:** 3 | **Prioridade:** P1

### Descrição
Expandir guia de contribuição.

### Tasks
- [ ] Step-by-step setup
- [ ] Code style guide
- [ ] PR template
- [ ] Issue templates

---

## STORY 7.3: API Documentation
**Pontos:** 5 | **Prioridade:** P2

### Descrição
Documentar API REST do server.

### Tasks
- [ ] Setup OpenAPI/Swagger
- [ ] Document auth endpoints
- [ ] Document agent endpoints
- [ ] Document MCP endpoints

---

# SPRINT BACKLOG

## Sprint 1 (Semana 1-2) - Foundation
| Story | Points | Assignee |
|-------|--------|----------|
| 2.1 Setup Test Infrastructure | 5 | - |
| 3.1 XSS Audit | 8 | - |
| 3.2 CSP Implementation | 5 | - |
| 1.1 MessageHandler Extract | 8 | - |

**Total:** 26 points

---

## Sprint 2 (Semana 3-4) - Core Refactoring
| Story | Points |
|-------|--------|
| 1.2 ConnectionManager Extract | 8 |
| 1.3 TaskQueue Extract | 5 |
| 1.4 ChatStore Refactor | 13 |
| 1.5 Types Cleanup | 3 |

**Total:** 29 points

---

## Sprint 3 (Semana 5-6) - Testing
| Story | Points |
|-------|--------|
| 2.2 MessageHandler Tests | 8 |
| 2.3 ConnectionManager Tests | 8 |
| 2.4 TaskQueue Tests | 5 |
| 2.5 Integration Tests | 8 |

**Total:** 29 points

---

## Sprint 4 (Semana 7-8) - Security + A11y
| Story | Points |
|-------|--------|
| 3.3 Input Validation | 5 |
| 3.4 IPC Security | 3 |
| 4.1 WCAG Audit | 8 |
| 4.2 Keyboard Navigation | 5 |

**Total:** 21 points

---

## Sprint 5 (Semana 9-10) - Performance
| Story | Points |
|-------|--------|
| 5.1 Bundle Analysis | 8 |
| 5.2 React Optimization | 5 |
| 5.3 Lazy Init | 3 |
| 4.3 Loading States | 5 |

**Total:** 21 points

---

## Sprint 6 (Semana 11-12) - DevOps + Docs
| Story | Points |
|-------|--------|
| 6.1 Coverage Gate | 3 |
| 6.2 Dependabot | 3 |
| 6.3 Auto Changelog | 2 |
| 7.1 Architecture Docs | 5 |
| 7.2 CONTRIBUTING | 3 |
| 7.3 API Docs | 5 |

**Total:** 21 points

---

# ESTIMATIVA TOTAL

| Épico | Stories | Points |
|-------|---------|--------|
| 1. ChatStore Refactor | 5 | 37 |
| 2. Test Pipeline | 5 | 34 |
| 3. Security | 4 | 21 |
| 4. UI/UX A11y | 3 | 18 |
| 5. Performance | 3 | 16 |
| 6. DevOps | 3 | 8 |
| 7. Documentation | 3 | 13 |

**TOTAL: 26 Stories | ~147 points | ~12-13 semanas**

---

# DEFINITION OF DONE

Para cada story, Done significa:

```
[ ] Código implementado
[ ] Testes escritos e passando
[ ] Coverage >= 80% (para código novo)
[ ] TypeScript strict mode passing
[ ] ESLint passing
[ ] PR criado e aprovado
[ ] Merged para main
```

---

# METRICAS DE SUCESSO

| Métrica | Antes | Meta |
|---------|-------|------|
| chatStore.ts linhas | 3613 | < 500 |
| Cobertura de testes | ~5% | > 80% |
| Arquivos > 500 linhas | 23 | < 5 |
| Violações XSS | Unknown | 0 |
| Violações WCAG | Unknown | 0 |
| Bundle size | Unknown | < 2MB |

---

*Documento gerado: $(date)*
*Última atualização: 2026-04-23*
