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

**Eigent** é a aplicação desktop cowork open source que capacita você a construir, gerenciar e implantar uma força de trabalho de IA personalizada, capaz de transformar seus fluxos de trabalho mais complexos em tarefas automatizadas.

Construído sobre o aclamado projeto open source da [CAMEL-AI][camel-site], nosso sistema introduz uma **Força de Trabalho Multiagente** que **aumenta a produtividade** por meio de execução paralela, personalização e proteção de privacidade.

### ⭐ 100% Open Source - 🥇 Implantação Local - 🏆 Integração MCP

- ✅ **Zero Configuração** - Nenhuma configuração técnica necessária
- ✅ **Coordenação Multiagente** - Gerencie fluxos de trabalho complexos com múltiplos agentes
- ✅ **Recursos Corporativos** - SSO / Controle de acesso
- ✅ **Implantação Local**
- ✅ **Open Source**
- ✅ **Suporte a Modelos Personalizados**
- ✅ **Integração MCP**

<br/>

[![][image-join-us]][join-us]

<details>
<summary><kbd>Sumário</kbd></summary>

#### TOC

- [🚀 Primeiros Passos](#-primeiros-passos)
  - [🏠 Implantação Local (Recomendado)](#-implantação-local-recomendado)
  - [⚡ Início Rápido (Conectado à Nuvem)](#-início-rápido-conectado-à-nuvem)
  - [🏢 Empresarial](#-empresarial)
  - [☁️ Versão em Nuvem](#️-versão-em-nuvem)
- [✨ Principais Recursos](#-principais-recursos)
  - [🏭 Força de Trabalho](#-força-de-trabalho)
  - [🧠 Suporte Abrangente a Modelos](#-suporte-abrangente-a-modelos)
  - [🔌 Integração de Ferramentas MCP (MCP)](#-integração-de-ferramentas-mcp-mcp)
  - [✋ Humano no Circuito](#-humano-no-circuito)
  - [👐 100% Código Aberto](#-100-código-aberto)
- [🧩 Casos de Uso](#-casos-de-uso)
- [🛠️ Stack Tecnológica](#-stack-tecnológica)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [🌟 Mantendo-se à Frente](#-mantendo-se-à-frente)
- [🗺️ Roadmap](#-roadmap)
- [🤝 Contribuição](#-contribuição)
  - [Contribuidores](#contribuidores)
- [❤️ Patrocínio](#-patrocínio)
- [📄 Licença Open Source](#-licença-open-source)
- [🌐 Comunidade & Contato](#-comunidade--contato)

####

<br/>

</details>

## **🚀 Primeiros Passos**

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

> Nota: Este modo se conecta aos serviços em nuvem do Eigent e requer registro de conta. Para uma experiência totalmente independente, utilize a [Implantação Local](#-implantação-local-recomendado) em vez disso.

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

📧 Para mais detalhes, entre em contato conosco em [info@eigent.ai](mailto:info@eigent.ai).

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

## **✨ Principais recursos**
Desbloqueie todo o potencial de produtividade excepcional com os poderosos recursos do Eigent—construídos para integração perfeita, execução de tarefas mais inteligente e automação ilimitada.

### 🏭 Força de Trabalho 
Emprega uma equipe de agentes de IA especializados que colaboram para resolver tarefas complexas. O Eigent divide dinamicamente as tarefas e ativa múltiplos agentes para trabalhar **em paralelo.**

O Eigent pré-definiu os seguintes agentes trabalhadores:

- **Agente Desenvolvedor:** Escreve e executa código, executa comandos de terminal.
- **Agente de Busca:** Pesquisa na web e extrai conteúdo.
- **Agente de Documento:** Cria e gerencia documentos.
- **Agente Multi-Modal:** Processa imagens e áudio.

![Workforce](https://eigent-ai.github.io/.github/assets/gif/feature_dynamic_workforce.gif)

<br/>

### 🧠 Suporte Abrangente a Modelos
Implante o Eigent localmente com seus modelos preferidos.

![Model](https://eigent-ai.github.io/.github/assets/gif/feature_local_model.gif)

<br/>

### 🔌 Integração de Ferramentas MCP (MCP)
O Eigent vem com ferramentas massivas integradas do **Protocolo de Contexto de Modelo (MCP)** (para navegação web, execução de código, Notion, Google suite, Slack etc.), e também permite que você **instale suas próprias ferramentas**. Equipe os agentes com exatamente as ferramentas certas para seus cenários – até mesmo integre APIs internas ou funções personalizadas – para aprimorar suas capacidades.

![MCP](https://eigent-ai.github.io/.github/assets/gif/feature_add_mcps.gif)

<br/>

### ✋ Humano no Circuito
Se uma tarefa ficar travada ou encontrar incerteza, o Eigent solicitará automaticamente entrada humana.

![Human-in-the-loop](https://eigent-ai.github.io/.github/assets/gif/feature_human_in_the_loop.gif)

<br/>

### 👐 100% Código Aberto
O Eigent é completamente de código aberto. Você pode baixar, inspecionar e modificar o código, garantindo transparência e promovendo um ecossistema impulsionado pela comunidade para inovação multi-agente.

![Código Aberto][image-opensource]

<br/>

## 🧩 Casos de Uso

### 1. Itinerário de Viagem de Tênis em Palm Springs com Resumo no Slack [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM0MzUxNTEzMzctNzExMyI.aIeysw.MUeG6ZcBxI1GqvPDvn4dcv-CDWw__1753435151337-7113)

<details> 

<summary><strong>Prompt:</strong> <kbd>Somos dois fãs de tênis e queremos ir ver o torneio de tênis ...</kbd></summary> 
<br> 
Somos dois fãs de tênis e queremos ir ver o torneio de tênis em Palm Springs 2026. Eu moro em SF - por favor, prepare um itinerário detalhado com voos, hotéis, coisas para fazer por 3 dias - na época em que as semifinais/finais estão acontecendo. Gostamos de trilhas, comida vegana e spas. Nosso orçamento é de $5K. O itinerário deve ser uma linha do tempo detalhada de horário, atividade, custo, outros detalhes e, se aplicável, um link para comprar ingressos/fazer reservas etc. para o item. Algumas preferências. Acesso a spa seria bom, mas não necessário. Quando você terminar esta tarefa, por favor gere um relatório html sobre esta viagem; escreva um resumo deste plano e envie o resumo de texto e o link do relatório html para o canal slack #tennis-trip-sf. 
</details> 

<br>

### 2. Gerar Relatório do Q2 a partir de Dados Bancários em CSV [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM1MjY4OTE4MDgtODczOSI.aIjJmQ.WTdoX9mATwrcBr_w53BmGEHPo8U__1753526891808-8739)

<details> 
<summary><strong>Prompt:</strong> <kbd>Por favor, me ajude a preparar uma demonstração financeira do Q2 baseada no meu ...</kbd></summary> 
<br> 
Por favor, me ajude a preparar uma demonstração financeira do Q2 baseada no meu arquivo de registro de transferência bancária bank_transacation.csv na minha área de trabalho para um relatório html com gráfico para investidores sobre quanto gastamos. 
</details> 

<br>

### 3. Automação de Relatório de Pesquisa de Mercado de Saúde do Reino Unido [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTMzOTM1NTg3OTctODcwNyI.aIey-Q.Jh9QXzYrRYarY0kz_qsgoj3ewX0__1753393558797-8707)

<details> 
<summary><strong>Prompt:</strong> <kbd>Analise a indústria de saúde do Reino Unido para apoiar o planejamento ...</kbd></summary> 
<br> 
Analise a indústria de saúde do Reino Unido para apoiar o planejamento da minha próxima empresa. Forneça uma visão geral abrangente do mercado, incluindo tendências atuais, projeções de crescimento e regulamentações relevantes. Identifique as 5–10 principais oportunidades, lacunas ou segmentos mal atendidos dentro do mercado. Apresente todas as descobertas em um relatório HTML bem estruturado e profissional. Em seguida, envie uma mensagem para o canal slack #eigentr-product-test quando esta tarefa estiver concluída para alinhar o conteúdo do relatório com meus colegas de equipe. 
</details> 

<br>

### 4. Viabilidade do Mercado Alemão de Skate Elétrico [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM2NTI4MjY3ODctNjk2Ig.aIjGiA.t-qIXxk_BZ4ENqa-yVIm0wMVyXU__1753652826787-696)

<details> 
<summary><strong>Prompt:</strong> <kbd>Somos uma empresa que produz skates elétricos de alto padrão ...</kbd></summary> 
<br> 
Somos uma empresa que produz skates elétricos de alto padrão e estamos considerando entrar no mercado alemão. Por favor, prepare um relatório detalhado de viabilidade de entrada no mercado. O relatório deve cobrir os seguintes aspectos: 1. Tamanho do Mercado & Regulamentações: Pesquise o tamanho do mercado, taxa de crescimento anual, principais players e participação de mercado de Veículos Elétricos Leves Pessoais (PLEVs) na Alemanha. Ao mesmo tempo, forneça um detalhamento e resumo das leis e regulamentações alemãs sobre o uso de skates elétricos em vias públicas, incluindo requisitos de certificação (como certificação ABE) e apólices de seguro. 2. Perfil do Consumidor: Analise o perfil dos potenciais consumidores alemães, incluindo idade, nível de renda, principais cenários de uso (deslocamento, lazer), fatores-chave de decisão de compra (preço, desempenho, marca, design) e os canais que normalmente utilizam para buscar informações (fóruns, redes sociais, lojas físicas). 3. Canais & Distribuição: Investigue as principais plataformas online de venda de eletrônicos na Alemanha (ex.: Amazon.de, MediaMarkt.de) e grandes redes físicas de artigos esportivos de alto padrão. Liste os 5 principais potenciais parceiros de distribuição online e offline e encontre, se possível, as informações de contato de seus departamentos de compras. 4. Custos & Precificação: Com base na estrutura de custos do produto no arquivo Product_Cost.csv na minha área de trabalho, e considerando taxas alfandegárias alemãs, Imposto sobre Valor Agregado (IVA), custos logísticos e de armazenagem, além de possíveis despesas de marketing, estime o Preço de Venda Sugerido ao Consumidor (MSRP) e analise sua competitividade no mercado. 5. Relatório Abrangente & Apresentação: Resuma todas as descobertas da pesquisa em um arquivo de relatório em HTML. O conteúdo deve incluir gráficos de dados, principais conclusões e uma recomendação final de estratégia de entrada no mercado (Recomendado / Não Recomendado / Recomendado com Condições). 
</details> 

<br>

### 5. Auditoria de SEO para Lançamento do Workforce Multiagent [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM2OTk5NzExNDQtNTY5NiI.aIex0w.jc_NIPmfIf9e3zGt-oG9fbMi3K4__1753699971144-5696)

<details> 
<summary><strong>Prompt:</strong> <kbd>Para apoiar o lançamento do nosso novo produto Workforce Multiagent ...</kbd></summary> 
<br> 
Para apoiar o lançamento do nosso novo produto Workforce Multiagent, por favor, execute uma auditoria completa de SEO no nosso site oficial (https://www.camel-ai.org/) e entregue um relatório detalhado de otimização com recomendações acionáveis. 
</details> 

<br>

### 6. Identificar Arquivos Duplicados em Downloads [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM3NjAzODgxNzEtMjQ4Ig.aIhKLQ.epOG--0Nj0o4Bqjtdqm9OZdaqRQ__1753760388171-248)

<details> 
<summary><strong>Prompt:</strong> <kbd>Tenho uma pasta chamada mydocs dentro do diretório Documents ...</kbd></summary> 
<br> 
Tenho uma pasta chamada mydocs dentro do diretório Documents. Por favor, escaneie-a e identifique todos os arquivos que sejam duplicados exatos ou quase duplicados — incluindo aqueles com conteúdo, tamanho ou formato idênticos (mesmo que nomes ou extensões de arquivo sejam diferentes). Liste-os claramente, agrupados por similaridade. 
</details> 

<br>

### 7. Adicionar Assinatura a PDF [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTQwOTU0ODM0NTItNTY2MSI.aJCHrA.Mg5yPOFqj86H_GQvvRNditzepXc__1754095483452-5661)

<details> 
<summary><strong>Prompt:</strong> <kbd>Por favor, adicione esta imagem de assinatura às áreas de assinatura no PDF ...</kbd></summary> 
<br> 
Por favor, adicione esta imagem de assinatura às áreas de assinatura no PDF. Você pode instalar a ferramenta de linha de comando ‘tesseract’ (necessária para localização confiável das ‘Áreas de Assinatura’ via OCR) para ajudar a concluir esta tarefa. 
</details> 

<br>

## 🛠️ Stack Tecnológica

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

## 🌟 Mantendo-se à Frente

> \[!IMPORTANT]
>
> **Dê uma estrela no Eigent**, você receberá todas as notificações de lançamento do GitHub sem qualquer atraso \~ ⭐️

![][image-star-us]

## 🗺️ Roadmap

| Tópicos                   | Issues   | Canal do Discord |
| ------------------------- | -- |-- |
| **Engenharia de Contexto** | - Cache de prompts<br> - Otimização de prompt do sistema<br> - Otimização de docstrings do toolkit<br> - Compressão de contexto | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Aprimoramento Multimodal** | - Compreensão de imagens mais precisa ao usar o navegador<br> - Geração avançada de vídeo | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Sistema Multiagente** | - Suporte do Workforce a fluxos fixos<br> - Suporte do Workforce a conversas em múltiplas rodadas | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Toolkit de Navegador** | - Integração com BrowseComp<br> - Melhoria de benchmark<br> - Proibir visitas repetidas a páginas<br> - Clique automático em botões de cache | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Toolkit de Documentos** | - Suporte à edição dinâmica de arquivos | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Toolkit de Terminal** | - Melhoria de benchmark<br> - Integração com Terminal-Bench | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Ambiente & RL** | - Design de ambiente<br> - Geração de dados<br> - Integração de frameworks de RL (VERL, TRL, OpenRLHF) | [**Entrar no Discord →**](https://discord.com/invite/CNcNpquyDc) |


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
[discord-url]: https://discord.com/invite/CNcNpquyDc
[discord-image]: https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb

[built-with-camel]:https://img.shields.io/badge/-Built--with--CAMEL-4C19E8.svg?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQ4IiBoZWlnaHQ9IjI3MiIgdmlld0JveD0iMCAwIDI0OCAyNzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik04LjgzMTE3IDE4LjU4NjVMMCAzMC44MjY3QzUuNDY2OTIgMzUuMDQzMiAxNS4xMzkxIDM4LjgyNTggMjQuODExNCAzNi4yOTU5QzMwLjY5ODggNDAuOTM0MSAzOS42NzAyIDQwLjIzMTMgNDQuMTU1OSA0MC4wOTA4QzQzLjQ1NSA0Ny4zOTk0IDQyLjQ3MzcgNzAuOTU1OCA0NC4xNTU5IDEwNi43MTJDNDUuODM4IDE0Mi40NjggNzEuNzcwOCAxNjYuODY4IDg0LjUyNjkgMTc0LjU5OEw3Ni4wMDAyIDIyMEw4NC41MjY5IDI3MkgxMDguOTE4TDk4LjAwMDIgMjIwTDEwOC45MTggMTc0LjU5OEwxMjkuOTQ0IDI3MkgxNTQuNzU2TDEzNC4xNSAxNzQuNTk4SDE4Ny4xMzdMMTY2LjUzMSAyNzJIMTkxLjc2M0wyMTIuMzY5IDE3NC41OThMMjI2IDIyMEwyMTIuMzY5IDI3MkgyMzcuNjAxTDI0OC4wMDEgMjIwTDIzNy4xOCAxNzQuNTk4QzIzOS4yODMgMTY5LjExNyAyNDAuNDAxIDE2Ni45NzYgMjQxLjgwNiAxNjEuMTA1QzI0OS4zNzUgMTI5LjQ4MSAyMzUuMDc3IDEwMy45MDEgMjI2LjY2NyA5NC40ODRMMjA2LjQ4MSA3My44MjNDMTk3LjY1IDY0Ljk2ODMgMTgyLjUxMSA2NC41NDY3IDE3Mi44MzkgNzIuNTU4MUMxNjUuNzI4IDc4LjQ0NzcgMTYxLjcwMSA3OC43NzI3IDE1NC43NTYgNzIuNTU4MUMxNTEuODEyIDcwLjAyODEgMTQ0LjUzNSA2MS40ODg5IDEzNC45OTEgNTMuNTgzN0MxMjUuMzE5IDQ1LjU3MjMgMTA4LjQ5NyA0OC45NDU1IDEwMi4xODkgNTUuNjkxOUw3My41OTMxIDg0LjM2NDRWNy42MjM0OUw3OS4xMjczIDBDNjAuOTA0MiAzLjY1NDMzIDIzLjgwMjEgOS41NjMwOSAxOS43NjUgMTAuNTc1MUMxNS43Mjc5IDExLjU4NyAxMC43OTM3IDE2LjMzNzcgOC44MzExNyAxOC41ODY1WiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTQzLjIwMzggMTguNzE4N0w0OS4wOTEyIDEzLjA0OTNMNTQuOTc4NyAxOC43MTg3TDQ5LjA5MTIgMjQuODI0Mkw0My4yMDM4IDE4LjcxODdaIiBmaWxsPSIjNEMxOUU4Ii8+Cjwvc3ZnPgo=

[eigent-github]: https://github.com/eigent-ai/eigent
[github-star]: https://img.shields.io/github/stars/eigent-ai?color=F5F4F0&labelColor=gray&style=plastic&logo=github
[camel-ai-org-github]: https://github.com/camel-ai

[camel-github]: https://github.com/camel-ai/camel
[contribution-link]: https://github.com/eigent-ai/eigent/blob/main/CONTRIBUTING.md

[social-x-link]: https://x.com/Eigent_AI
[social-x-shield]: https://img.shields.io/badge/-%40Eigent_AI-white?labelColor=gray&logo=x&logoColor=white&style=plastic

[reddit-url]: https://www.reddit.com/r/CamelAI/
[reddit-image]: https://img.shields.io/reddit/subreddit-subscribers/CamelAI?style=plastic&logo=reddit&label=r%2FCAMEL&labelColor=white

[wechat-url]: https://ghli.org/camel/wechat.png
[wechat-image]: https://img.shields.io/badge/WeChat-CamelAIOrg-brightgreen?logo=wechat&logoColor=white

[sponsor-link]: https://github.com/sponsors/camel-ai
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20CAMEL--AI-1d1d1d?logo=github&logoColor=white&style=plastic

[eigent-download]: https://www.eigent.ai/download
[download-shield]: https://img.shields.io/badge/Download%20Eigent-363AF5?style=plastic

[join-us]:https://eigent-ai.notion.site/eigent-ai-careers
[join-us-image]:https://img.shields.io/badge/Join%20Us-yellow?style=plastic

<!-- camel & eigent -->
[camel-site]: https://www.camel-ai.org
[eigent-site]: https://www.eigent.ai
[docs-site]: https://docs.eigent.ai
[github-issue-link]: https://github.com/eigent-ai/eigent/issues

<!-- marketing -->
[image-seperator]: https://eigent-ai.github.io/.github/assets/seperator.png 
[image-head]: https://eigent-ai.github.io/.github/assets/head.png 
[image-public-beta]: https://eigent-ai.github.io/.github/assets/banner.png
[image-star-us]: https://eigent-ai.github.io/.github/assets/star-us.gif
[image-opensource]: https://eigent-ai.github.io/.github/assets/opensource.png
[image-wechat]: https://eigent-ai.github.io/.github/assets/wechat.png
[image-join-us]: https://camel-ai.github.io/camel_asset/graphics/join_us.png

<!-- feature -->
[image-workforce]: https://eigent-ai.github.io/.github/assets/feature_dynamic_workforce.gif
[image-human-in-the-loop]: https://eigent-ai.github.io/.github/assets/feature_human_in_the_loop.gif
[image-customise-workers]: https://eigent-ai.github.io/.github/assets/feature_customise_workers.gif
[image-add-mcps]: https://eigent-ai.github.io/.github/assets/feature_add_mcps.gif
[image-local-model]: https://eigent-ai.github.io/.github/assets/feature_local_model.gif
