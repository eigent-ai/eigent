<div align="center"><a name="readme-top"></a>

[![][image-head]][eigent-site]

[![][image-seperator]][eigent-site]

### Eigent: O Desktop Cowork Open Source para Desbloquear sua Produtividade Excepcional

<!-- SHIELD GROUP -->

[![][download-shield]][eigent-download]
[![][github-star]][eigent-github]
[![][social-x-shield]][social-x-link]
[![][discord-image]][discord-url]<br>
[![Reddit][reddit-image]][reddit-url]
[![Wechat][wechat-image]][wechat-url]
[![][sponsor-shield]][sponsor-link]
[![][built-with-camel]][camel-github]
[![][join-us-image]][join-us]

</div>

<hr/>
<div align="center">

[English](./README.md) · **Português** · [简体中文](./README_CN.md) · [日本語](./README_JA.md) · [Site Oficial][eigent-site] · [Documentação][docs-site] · [Feedback][github-issue-link]

</div>
<br/>

**Eigent** é a aplicação desktop Cowork código aberto que capacita você a construir, gerenciar e implantar uma força de trabalho de IA personalizada, capaz de transformar seus fluxos de trabalho mais complexos em tarefas automatizadas. Como um produto líder de Cowork código aberto, o Eigent reúne o melhor da colaboração open source e da automação impulsionada por IA.

Construído sobre o aclamado projeto open source da [CAMEL-AI][camel-site], nosso sistema introduz uma **Força de Trabalho Multiagente** que **aumenta a produtividade** por meio de execução paralela, personalização e proteção de privacidade.

### ⭐ 100% Open Source - 🥇 Implantação Local - 🏆 Integração MCP

- ✅ **Zero Configuração** - Nenhuma configuração técnica necessária
- ✅ **Coordenação Multiagente** - Gerencie fluxos de trabalho complexos com múltiplos agentes
- ✅ **Harness de Agente Único** - Execute tarefas focadas com um agente dedicado
- ✅ **Implantação Local**
- ✅ **Open Source**
- ✅ **Independente de Modelo** - Compatível com qualquer modelo de sua escolha
- ✅ **Integração MCP**
- ✅ **Integração de Skills**
- ✅ **Toolkits Integrados de Navegador e Terminal**
- ✅ **E Muito Mais**
- ✅ **Recursos Corporativos** - SSO, controle de acesso e consultas personalizadas

<br/>

[![][image-join-us]][join-us]

<details>
<summary><kbd>Sumário</kbd></summary>

#### TOC

- [🚀 Primeiros Passos com Cowork Open Source](#-primeiros-passos-com-Cowork-open-source)
  - [🏠 Implantação Local (Recomendado)](#-implanta%C3%A7%C3%A3o-local-recomendado)
  - [⚡ Início Rápido (Conectado à Nuvem)](#-in%C3%ADcio-r%C3%A1pido-conectado-%C3%A0-nuvem)
  - [🏢 Empresarial](#-empresarial)
  - [☁️ Versão em Nuvem](#%EF%B8%8F-vers%C3%A3o-em-nuvem)
- [✨ Principais Recursos - Cowork Open Source](#-principais-recursos---Cowork-open-source)
  - [🧑‍💻 Cooperar com um Único Agente](#-cooperar-com-um-único-agente)
  - [🏭 Cooperar com uma Força de Trabalho](#-cooperar-com-uma-força-de-trabalho)
  - [⏰ Automação](#-automação)
  - [🔒 Local e Seguro](#-local-e-seguro)
  - [🧠 Independente de Modelo](#-independente-de-modelo)
  - [👐 100% Código Aberto](#-100-c%C3%B3digo-aberto)
- [🧩 Casos de Uso - Cowork Open Source](#-casos-de-uso---Cowork-open-source)
  - [Para Desenvolvedores](#para-desenvolvedores)
  - [Destaques](#destaques)
- [🛠️ Stack Tecnológica](#-stack-tecnol%C3%B3gica)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [🌟 Mantendo-se à Frente - Cowork Open Source](#-mantendo-se-%C3%A0-frente---Cowork-open-source)
- [🗺️ Roadmap - Cowork Open Source](#-roadmap---Cowork-open-source)
- [🤝 Contribuição](#-contribui%C3%A7%C3%A3o)
  - [Contribuidores](#contribuidores)
- [❤️ Patrocínio](#-patroc%C3%ADnio)
- [📄 Licença Open Source](#-licen%C3%A7a-open-source)
- [🌐 Comunidade & Contato](#-comunidade--contato)

####

<br/>

</details>

## **🚀 Primeiros Passos com Cowork Open Source**

> **🔓 Construído em Público** — Eigent é **100% open source** desde o primeiro dia. Cada funcionalidade, cada commit e cada decisão são transparentes. Acreditamos que as melhores ferramentas de IA devem ser construídas abertamente com a comunidade, e não a portas fechadas.

### 🏠 Implantação Local (Recomendado)

A forma recomendada de executar o Eigent — totalmente independente, com controle completo sobre seus dados, sem necessidade de conta em nuvem.

👉 **[Guia Completo de Implantação Local](./server/README_PT-BR.md)**

Esta configuração inclui:

- Servidor backend local com API completa
- Integração de modelos locais (vLLM, Ollama, LM Studio, etc.)
- Isolamento completo de serviços em nuvem
- Zero dependências externas

### ⚡ Início Rápido (Conectado à Nuvem)

Para uma visualização rápida usando nosso backend em nuvem — comece em segundos:

#### Pré-requisitos

- Node.js (versão 18–22) e npm

#### Passos

```bash
git clone https://github.com/eigent-ai/eigent.git
cd eigent
npm install
npm run dev
```

> Nota: Este modo se conecta aos serviços em nuvem do Eigent e requer registro de conta. Para uma experiência totalmente independente, utilize a [Implantação Local](#-implanta%C3%A7%C3%A3o-local-recomendado) em vez disso.

#### Atualizando Dependências

Após baixar novo código (`git pull`), atualize as dependências do frontend e do backend:

```bash
# 1. Atualizar dependências do frontend (no diretório raiz do projeto)
npm install

# 2. Atualizar dependências do backend/Python (no diretório backend)
cd backend
uv sync
```

### 🏢 Empresarial

Para organizações que requerem máxima segurança, personalização e controle:

- **Recursos Exclusivos** (como SSO e desenvolvimento personalizado)
- **Implantação Empresarial Escalável**
- **SLAs Negociados** e serviços de implementação

📧 Para mais detalhes, [fale com nossa equipe de vendas](https://www.eigent.ai/contact-sales).

### ☁️ Versão em Nuvem

Para equipes que preferem infraestrutura gerenciada, também oferecemos uma plataforma em nuvem. A maneira mais rápida de experimentar as capacidades de IA multi-agente do Eigent sem complexidade de configuração. Nós hospedaremos os modelos, APIs e armazenamento em nuvem, garantindo que o Eigent funcione perfeitamente.

- **Acesso Instantâneo** - Comece a construir fluxos de trabalho multi-agente em minutos.
- **Infraestrutura Gerenciada** - Nós cuidamos da escalabilidade, atualizações e manutenção.
- **Suporte Premium** - Assine e obtenha assistência prioritária de nossa equipe de engenharia.

<br/>

[![image-public-beta]][eigent-download]

<div align="right">
<a href="https://www.eigent.ai/download">Comece em Eigent.ai →</a>
</div>

## **✨ Principais recursos - Cowork Open Source**

### 🧑‍💻 Cooperar com um Único Agente

Comece com um agente focado para tarefas diretas. Pesquise, escreva, depure e trabalhe ao lado dele no seu espaço de trabalho desktop.

### 🏭 Cooperar com uma Força de Trabalho

Escale para vários agentes especializados que dividem o trabalho, colaboram em paralelo e executam juntos fluxos complexos de várias etapas.

### ⏰ Automação

Agende fluxos de trabalho recorrentes e deixe os agentes executarem tarefas no momento certo — para que o trabalho continue mesmo quando você se ausentar.

### 🔒 Local e Seguro

Execute agentes na sua máquina com processamento local-first. Seus arquivos, credenciais e contexto permanecem sob seu controle.

### 🧠 Independente de Modelo

Conecte os modelos que você já utiliza — APIs na nuvem, gateways corporativos ou inferência local — sem ficar preso a um único fornecedor.

### 👐 100% Código Aberto

O Eigent é completamente de código aberto. Você pode baixar, inspecionar e modificar o código, garantindo transparência e promovendo um ecossistema impulsionado pela comunidade para inovação multi-agente.

## 🧩 Casos de Uso - Cowork Open Source

Explore como o Eigent transforma trabalhos complexos no desktop em fluxos de agentes repetíveis.

### Para Desenvolvedores

#### [Crie 10 Jogos HTML5 do Ano-Novo Chinês com o Eigent](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games)

Coordene agentes em paralelo para criar dez jogos de navegador polidos e compatíveis com dispositivos móveis, abrangendo vários gêneros, com pontuação, dificuldade progressiva e reinício.

[Ver demonstração →](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games/video)

[Ver guia →](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games)

#### [Crie um Jogo de Plataforma 3D Snow Bros com Gemini 3.1 Pro](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini)

Crie um jogo de plataforma 3D completo para navegador, com combate usando bolas de neve, combos de inimigos, pontuação, vidas, dificuldade progressiva e cenários em camadas.

[Ver demonstração →](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini/video)

[Ver guia →](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini)

#### [Automatize Relatórios Mensais de Desenvolvimento com DeepSeek via Ollama](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama)

Revise um mês de pull requests do GitHub com um modelo hospedado localmente, gere um resumo em Word e prepare a atualização de lançamento correspondente para o Slack.

[Ver demonstração →](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama/video)

[Ver guia →](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama)

### Destaques

#### [Organize Arquivos da Área de Trabalho](https://www.eigent.ai/use-cases/organize-desktop-files)

Peça ao Eigent para inspecionar uma área de trabalho desorganizada e organizar os arquivos em uma estrutura mais limpa e útil diretamente na sua máquina.

[Ver demonstração →](https://www.eigent.ai/use-cases/organize-desktop-files/video)

[Ver guia →](https://www.eigent.ai/use-cases/organize-desktop-files)

#### [Audite Falhas de CI de ML com Gemini 3.5 Flash no Eigent](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents)

Orquestre uma investigação multiagente de CI que coleta logs, compara valores de referência, rastreia evidências, delega raciocínio profundo e produz relatórios estruturados de auditoria.

[Ver demonstração →](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents/video)

[Ver guia →](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents)

#### [Integração e Relatórios para Sistemas de Gerenciamento de Tickets](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting)

Importe dados locais de tickets para um sistema de gerenciamento no navegador e gere um relatório estatístico com gráficos e resumos visuais.

[Ver demonstração →](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting/video)

[Ver guia →](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting)

[Explore mais casos de uso →](https://www.eigent.ai/use-cases)

## 🛠️ Stack Tecnológica

O desktop Eigent Cowork código aberto é construído com tecnologias modernas e confiáveis que garantem escalabilidade, desempenho e extensibilidade.

### Backend

- **Framework:** FastAPI
- **Gerenciador de Pacotes:** uv
- **Servidor Assíncrono:** Uvicorn
- **Autenticação:** OAuth 2.0, Passlib
- **Framework Multiagente:** CAMEL

### Frontend

- **Framework:** React
- **Framework de App Desktop:** Electron
- **Linguagem:** TypeScript
- **UI:** Tailwind CSS, Radix UI, Lucide React, Framer Motion
- **Gerenciamento de Estado:** Zustand
- **Editor de Fluxo:** React Flow

## 🌟 Mantendo-se à Frente - Cowork Open Source

> [!IMPORTANT]
>
> **Dê uma estrela no Eigent**, você receberá todas as notificações de lançamento do GitHub sem qualquer atraso ~ ⭐️

![][image-star-us]

## 🗺️ Roadmap - Cowork Open Source

Nosso Cowork código aberto continua a evoluir com feedback da comunidade. Aqui está o que vem a seguir:

| Tópicos                      | Issues                                                                                                                                       | Canal do Discord                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Engenharia de Contexto**   | - Cache de prompts<br> - Otimização de prompt do sistema<br> - Otimização de docstrings do toolkit<br> - Compressão de contexto              | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Aprimoramento Multimodal** | - Compreensão de imagens mais precisa ao usar o navegador<br> - Geração avançada de vídeo                                                    | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Sistema Multiagente**      | - Suporte do Workforce a fluxos fixos<br> - Suporte do Workforce a conversas em múltiplas rodadas                                            | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Toolkit de Navegador**     | - Integração com BrowseComp<br> - Melhoria de benchmark<br> - Proibir visitas repetidas a páginas<br> - Clique automático em botões de cache | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Toolkit de Documentos**    | - Suporte à edição dinâmica de arquivos                                                                                                      | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Toolkit de Terminal**      | - Melhoria de benchmark<br> - Integração com Terminal-Bench                                                                                  | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Ambiente & RL**            | - Design de ambiente<br> - Geração de dados<br> - Integração de frameworks de RL (VERL, TRL, OpenRLHF)                                       | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |

## [🤝 Contribuição][contribution-link]

Acreditamos em construir confiança e abraçar todas as formas de colaboração open source. Suas contribuições criativas ajudam a impulsionar a inovação do `Eigent`. Explore as issues e projetos no GitHub para participar e mostrar do que você é capaz 🤝❤️ [Guia de Contribuição][contribution-link]

## Contribuidores

<a href="https://github.com/eigent-ai/eigent/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=eigent-ai/eigent" />
</a>

Feito com [contrib.rocks](https://contrib.rocks).

<br>

## [❤️ Patrocínio][sponsor-link]

O Eigent é construído sobre as pesquisas e infraestruturas da [CAMEL-AI.org][camel-ai-org-github]. [Patrocinar a CAMEL-AI.org][sponsor-link] tornará o `Eigent` ainda melhor.

## **📄 Licença Open Source**

Este repositório é licenciado sob a [Licença Apache 2.0](LICENSE).

## 🌐 Comunidade & Contato

Para mais informações, entre em contato pelo e-mail info@eigent.ai

- **GitHub Issues:** Relate bugs, solicite funcionalidades e acompanhe o desenvolvimento. [Enviar uma issue][github-issue-link]

- **Discord:** Obtenha suporte em tempo real, converse com a comunidade e fique atualizado. [Junte-se a nós](https://discord.com/invite/CNcNpquyDc)

- **X (Twitter):** Siga para atualizações, insights de IA e anúncios importantes. [Siga-nos][social-x-link]

- **Comunidade WeChat:** Escaneie o QR code abaixo para adicionar nosso assistente no WeChat e entrar no grupo da comunidade WeChat.

<div align="center">
  <img src="./src/assets/wechat_qr.jpg" width="200" style="display: inline-block; margin: 10px;">
</div>

<!-- LINK GROUP -->

<!-- Social -->

<!-- camel & eigent -->

<!-- marketing -->

<!-- feature -->

[built-with-camel]: https://img.shields.io/badge/-Built--with--CAMEL-4C19E8.svg?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQ4IiBoZWlnaHQ9IjI3MiIgdmlld0JveD0iMCAwIDI0OCAyNzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik04LjgzMTE3IDE4LjU4NjVMMCAzMC44MjY3QzUuNDY2OTIgMzUuMDQzMiAxNS4xMzkxIDM4LjgyNTggMjQuODExNCAzNi4yOTU5QzMwLjY5ODggNDAuOTM0MSAzOS42NzAyIDQwLjIzMTMgNDQuMTU1OSA0MC4wOTA4QzQzLjQ1NSA0Ny4zOTk0IDQyLjQ3MzcgNzAuOTU1OCA0NC4xNTU5IDEwNi43MTJDNDUuODM4IDE0Mi40NjggNzEuNzcwOCAxNjYuODY4IDg0LjUyNjkgMTc0LjU5OEw3Ni4wMDAyIDIyMEw4NC41MjY5IDI3MkgxMDguOTE4TDk4LjAwMDIgMjIwTDEwOC45MTggMTc0LjU5OEwxMjkuOTQ0IDI3MkgxNTQuNzU2TDEzNC4xNSAxNzQuNTk4SDE4Ny4xMzdMMTY2LjUzMSAyNzJIMTkxLjc2M0wyMTIuMzY5IDE3NC41OThMMjI2IDIyMEwyMTIuMzY5IDI3MkgyMzcuNjAxTDI0OC4wMDEgMjIwTDIzNy4xOCAxNzQuNTk4QzIzOS4yODMgMTY5LjExNyAyNDAuNDAxIDE2Ni45NzYgMjQxLjgwNiAxNjEuMTA1QzI0OS4zNzUgMTI5LjQ4MSAyMzUuMDc3IDEwMy45MDEgMjI2LjY2NyA5NC40ODRMMjA2LjQ4MSA3My44MjNDMTk3LjY1IDY0Ljk2ODMgMTgyLjUxMSA2NC41NDY3IDE3Mi44MzkgNzIuNTU4MUMxNjUuNzI4IDc4LjQ0NzcgMTYxLjcwMSA3OC43NzI3IDE1NC43NTYgNzIuNTU4MUMxNTEuODEyIDcwLjAyODEgMTQ0LjUzNSA2MS40ODg5IDEzNC45OTEgNTMuNTgzN0MxMjUuMzE5IDQ1LjU3MjMgMTA4LjQ5NyA0OC45NDU1IDEwMi4xODkgNTUuNjkxOUw3My41OTMxIDg0LjM2NDRWNy42MjM0OUw3OS4xMjczIDBDNjAuOTA0MiAzLjY1NDMzIDIzLjgwMjEgOS41NjMwOSAxOS43NjUgMTAuNTc1MUMxNS43Mjc5IDExLjU4NyAxMC43OTM3IDE2LjMzNzcgOC44MzExNyAxOC41ODY1WiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTQzLjIwMzggMTguNzE4N0w0OS4wOTEyIDEzLjA0OTNMNTQuOTc4NyAxOC43MTg3TDQ5LjA5MTIgMjQuODI0Mkw0My4yMDM4IDE4LjcxODdaIiBmaWxsPSIjNEMxOUU4Ii8+Cjwvc3ZnPgo=
[camel-ai-org-github]: https://github.com/camel-ai
[camel-github]: https://github.com/camel-ai/camel
[camel-site]: https://www.camel-ai.org
[contribution-link]: https://github.com/eigent-ai/eigent/blob/main/CONTRIBUTING.md
[discord-image]: https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb
[discord-url]: https://discord.com/invite/CNcNpquyDc
[docs-site]: https://docs.eigent.ai
[download-shield]: https://img.shields.io/badge/Download%20Eigent-363AF5?style=plastic
[eigent-download]: https://www.eigent.ai/download
[eigent-github]: https://github.com/eigent-ai/eigent
[eigent-site]: https://www.eigent.ai
[github-issue-link]: https://github.com/eigent-ai/eigent/issues
[github-star]: https://img.shields.io/github/stars/eigent-ai?color=F5F4F0&labelColor=gray&style=plastic&logo=github
[image-head]: https://eigent-ai.github.io/.github/assets/head.png
[image-join-us]: https://camel-ai.github.io/camel_asset/graphics/join_us.png
[image-opensource]: https://eigent-ai.github.io/.github/assets/opensource.png
[image-public-beta]: https://eigent-ai.github.io/.github/assets/banner.png
[image-seperator]: https://eigent-ai.github.io/.github/assets/seperator.png
[image-star-us]: https://eigent-ai.github.io/.github/assets/star-us.gif
[join-us]: https://www.eigent.ai/careers
[join-us-image]: https://img.shields.io/badge/Join%20Us-yellow?style=plastic
[reddit-image]: https://img.shields.io/reddit/subreddit-subscribers/CamelAI?style=plastic&logo=reddit&label=r%2FCAMEL&labelColor=white
[reddit-url]: https://www.reddit.com/r/CamelAI/
[social-x-link]: https://x.com/Eigent_AI
[social-x-shield]: https://img.shields.io/badge/-%40Eigent_AI-white?labelColor=gray&logo=x&logoColor=white&style=plastic
[sponsor-link]: https://github.com/sponsors/camel-ai
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20CAMEL--AI-1d1d1d?logo=github&logoColor=white&style=plastic
[wechat-image]: https://img.shields.io/badge/WeChat-CamelAIOrg-brightgreen?logo=wechat&logoColor=white
[wechat-url]: https://ghli.org/camel/wechat.png
