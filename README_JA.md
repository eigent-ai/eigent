<div align="center"><a name="readme-top"></a>

[![][image-head]][eigent-site]

[![][image-seperator]][eigent-site]

### Eigent: 卓越した生産性を実現するオープンソースのコワークデスクトップ

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

[English](./README.md) · [Português](./README_PT-BR.md) · [简体中文](./README_CN.md) · **日本語** · [公式サイト][eigent-site] · [ドキュメント][docs-site] · [フィードバック][github-issue-link]

</div>
<br/>

**Eigent**は、オープンソースのコワークデスクトップアプリケーションです。複雑なワークフローを自動化タスクに変換できるカスタムAIワークフォースを構築、管理、デプロイする力を提供します。先進的なオープンソース Cowork製品として、EigentはオープンソースコラボレーションとAI駆動の自動化の最良の部分を組み合わせています。

[CAMEL-AI][camel-site]の評価の高いオープンソースプロジェクトを基盤として構築されており、**マルチエージェントワークフォース**を導入し、並列実行、カスタマイズ、プライバシー保護を通じて**生産性を向上**させます。

### ⭐ 100%オープンソース - 🥇 ローカルデプロイメント - 🏆 MCP統合

- ✅ **ゼロセットアップ** - 技術的な設定は不要
- ✅ **マルチエージェント連携** - 複雑なマルチエージェントワークフローを処理
- ✅ **シングルエージェントハーネス** - 1つの専任エージェントで明確なタスクを実行
- ✅ **ローカルデプロイメント**
- ✅ **オープンソース**
- ✅ **モデル非依存** - 任意のモデルをサポート
- ✅ **MCP統合**
- ✅ **スキル統合**
- ✅ **組み込みブラウザ＆ターミナルツールキット**
- ✅ **その他多数**
- ✅ **エンタープライズ機能** - SSO、アクセス制御、個別相談

<br/>

[![][image-join-us]][join-us]

<details>
<summary><kbd>目次</kbd></summary>

#### TOC

- [🚀 はじめに - オープンソース Cowork](#-はじめに---オープンソース Cowork)
  - [🏠 ローカルデプロイメント（推奨）](#-%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E3%83%A1%E3%83%B3%E3%83%88%E6%8E%A8%E5%A5%A8)
  - [⚡ クイックスタート（クラウド接続）](#-%E3%82%AF%E3%82%A4%E3%83%83%E3%82%AF%E3%82%B9%E3%82%BF%E3%83%BC%E3%83%88%E3%82%AF%E3%83%A9%E3%82%A6%E3%83%89%E6%8E%A5%E7%B6%9A)
  - [🏢 エンタープライズ](#-%E3%82%A8%E3%83%B3%E3%82%BF%E3%83%BC%E3%83%97%E3%83%A9%E3%82%A4%E3%82%BA)
  - [☁️ クラウドバージョン](#%EF%B8%8F-%E3%82%AF%E3%83%A9%E3%82%A6%E3%83%89%E3%83%90%E3%83%BC%E3%82%B8%E3%83%A7%E3%83%B3)
- [✨ 主な機能 - オープンソース Cowork](#-主な機能---オープンソース Cowork)
  - [🧑‍💻 シングルエージェントとの協働](#-シングルエージェントとの協働)
  - [🏭 ワークフォースとの協働](#-ワークフォースとの協働)
  - [⏰ 自動化](#-自動化)
  - [🔒 ローカル＆セキュア](#-ローカルセキュア)
  - [🧠 モデル非依存](#-モデル非依存)
  - [👐 100%オープンソース](#-100%E3%82%AA%E3%83%BC%E3%83%97%E3%83%B3%E3%82%BD%E3%83%BC%E3%82%B9)
- [🧩 ユースケース - オープンソース Cowork](#-ユースケース---オープンソース Cowork)
  - [開発者向け](#開発者向け)
  - [注目](#注目)
- [🛠️ 技術スタック](#%EF%B8%8F-%E6%8A%80%E8%A1%93%E3%82%B9%E3%82%BF%E3%83%83%E3%82%AF)
  - [バックエンド](#%E3%83%90%E3%83%83%E3%82%AF%E3%82%A8%E3%83%B3%E3%83%89)
  - [フロントエンド](#%E3%83%95%E3%83%AD%E3%83%B3%E3%83%88%E3%82%A8%E3%83%B3%E3%83%89)
- [🌟 最新情報を入手 - オープンソース Cowork](#最新情報を入手---オープンソース Cowork)
- [🗺️ ロードマップ - オープンソース Cowork](#️-ロードマップ---オープンソース Cowork)
- [📖 コントリビューション](#-%E3%82%B3%E3%83%B3%E3%83%88%E3%83%AA%E3%83%93%E3%83%A5%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3)
- [エコシステム](#%E3%82%A8%E3%82%B3%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0)
- [📄 オープンソースライセンス](#-%E3%82%AA%E3%83%BC%E3%83%97%E3%83%B3%E3%82%BD%E3%83%BC%E3%82%B9%E3%83%A9%E3%82%A4%E3%82%BB%E3%83%B3%E3%82%B9)
- [🌐 コミュニティ & お問い合わせ](#-%E3%82%B3%E3%83%9F%E3%83%A5%E3%83%8B%E3%83%86%E3%82%A3--%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B)

####

<br/>

</details>

## **🚀 はじめに - オープンソース Cowork**

> **🔓 オープンに開発** — Eigentは初日から**100%オープンソース**です。すべての機能、すべてのコミット、すべての決定が透明です。最高のAIツールは、閉じられたドアの後ろではなく、コミュニティと共にオープンに構築されるべきだと信じています。

### 🏠 ローカルデプロイメント（推奨）

Eigentを実行する推奨方法 — データを完全に制御でき、クラウドアカウント不要で完全にスタンドアロンで動作します。

👉 **[ローカルデプロイメント完全ガイド](./server/README_EN.md)**

このセットアップには以下が含まれます：

- 完全なAPIを備えたローカルバックエンドサーバー
- ローカルモデル統合（vLLM、Ollama、LM Studioなど）
- クラウドサービスからの完全な分離
- 外部依存ゼロ

### ⚡ クイックスタート（クラウド接続）

クラウドバックエンドを使用した簡単なプレビュー — 数秒で開始できます：

#### 前提条件

- Node.js（バージョン18-22）およびnpm

#### 手順

```bash
git clone https://github.com/eigent-ai/eigent.git
cd eigent
npm install
npm run dev
```

> 注：このモードはEigentクラウドサービスに接続し、アカウント登録が必要です。完全にスタンドアロンで使用する場合は、代わりに[ローカルデプロイメント](#-%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E3%83%A1%E3%83%B3%E3%83%88%E6%8E%A8%E5%A5%A8)を使用してください。

#### 依存関係の更新

新しいコードを取得（`git pull`）した後、フロントエンドとバックエンドの両方の依存関係を更新します：

```bash
# 1. フロントエンド依存関係を更新（プロジェクトルートで）
npm install

# 2. バックエンド/Python依存関係を更新（backendディレクトリで）
cd backend
uv sync
```

### 🏢 エンタープライズ

最大限のセキュリティ、カスタマイズ、制御を必要とする組織向け：

- **限定機能**（SSO & カスタム開発など）
- **スケーラブルなエンタープライズデプロイメント**
- **交渉可能なSLA** & 導入サービス

📧 詳細については、[営業チームにお問い合わせください](https://www.eigent.ai/contact-sales)。

### ☁️ クラウドバージョン

マネージドインフラストラクチャを好むチーム向けに、クラウドプラットフォームも提供しています。セットアップの複雑さなしにEigentのマルチエージェントAI機能を体験する最速の方法です。モデル、API、クラウドストレージをホストし、Eigentがシームレスに動作することを保証します。

- **即時アクセス** - 数分でマルチエージェントワークフローの構築を開始。
- **マネージドインフラストラクチャ** - スケーリング、更新、メンテナンスを私たちが処理。
- **プレミアムサポート** - サブスクリプションでエンジニアリングチームからの優先サポートを受けられます。

<br/>

[![image-public-beta]][eigent-download]

<div align="right">
<a href="https://www.eigent.ai/download">Eigent.aiで始める →</a>
</div>

## **✨ 主な機能 - オープンソース Cowork**

### 🧑‍💻 シングルエージェントとの協働

明確なタスクには、1つの専任エージェントから始めます。デスクトップワークスペースで、調査、執筆、デバッグ、操作をエージェントと一緒に進められます。

### 🏭 ワークフォースとの協働

複数の専門エージェントへ拡張し、作業を分担しながら並列で連携し、複雑な複数ステップのワークフローを共同で実行します。

### ⏰ 自動化

定期的なワークフローをスケジュールし、適切なタイミングでエージェントにタスクを実行させます。席を離れている間も作業は進み続けます。

### 🔒 ローカル＆セキュア

ローカルファーストの実行方式で、エージェントを自分のマシン上で動かします。ファイル、認証情報、コンテキストは常に自分の管理下に置かれます。

### 🧠 モデル非依存

クラウドAPI、エンタープライズゲートウェイ、ローカル推論など、すでに使用しているモデルを接続できます。特定のベンダーに縛られることはありません。

### 👐 100%オープンソース

Eigentは完全にオープンソースです。コードをダウンロード、検査、修正でき、透明性を確保し、マルチエージェントイノベーションのためのコミュニティ主導のエコシステムを育成します。

## 🧩 ユースケース - オープンソース Cowork

Eigentが複雑なデスクトップ作業を、繰り返し実行できるエージェントワークフローへ変える方法をご覧ください。

### 開発者向け

#### [Eigentで旧正月をテーマにしたHTML5ゲームを10本作成](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games)

複数のエージェントを並列に連携させ、スコア、段階的な難易度、リスタート機能を備えた、モバイル対応の多彩なブラウザゲームを10本作成します。

[デモを見る →](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games/video)

[ガイドを見る →](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games)

#### [Gemini 3.1 Proで3D Snow Brosプラットフォーマーを構築](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini)

雪玉での戦闘、敵の連鎖、スコア、ライフ、段階的な難易度、奥行きのある環境を備えた、ブラウザ向けの完全な3Dプラットフォームゲームを作成します。

[デモを見る →](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini/video)

[ガイドを見る →](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini)

#### [Ollama経由のDeepSeekで月次開発レポートを自動化](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama)

ローカルでホストしたモデルを使って1か月分のGitHubプルリクエストを確認し、Word形式の要約とSlack向けのリリース更新を作成します。

[デモを見る →](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama/video)

[ガイドを見る →](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama)

### 注目

#### [デスクトップファイルを整理](https://www.eigent.ai/use-cases/organize-desktop-files)

Eigentが散らかったデスクトップを確認し、自分のマシン上でファイルをより整理された使いやすい構成へまとめます。

[デモを見る →](https://www.eigent.ai/use-cases/organize-desktop-files/video)

[ガイドを見る →](https://www.eigent.ai/use-cases/organize-desktop-files)

#### [EigentとGemini 3.5 FlashでML CI障害を監査](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents)

ログ取得、基準値との比較、証拠の追跡、深い推論の委任、構造化された監査レポートの生成まで、マルチエージェントによるCI調査を編成します。

[デモを見る →](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents/video)

[ガイドを見る →](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents)

#### [チケット管理システムの統合とレポート作成](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting)

ローカルのチケットデータをブラウザベースの管理システムへ取り込み、チャートと視覚的な要約を含む統計レポートを生成します。

[デモを見る →](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting/video)

[ガイドを見る →](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting)

[その他のユースケースを見る →](https://www.eigent.ai/use-cases)

## 🛠️ 技術スタック

Eigent オープンソース Coworkデスクトップは、スケーラビリティ、パフォーマンス、拡張性を確保する最新の信頼性の高いテクノロジーで構築されています。

### バックエンド

- **フレームワーク:** FastAPI
- **パッケージマネージャー:** uv
- **非同期サーバー:** Uvicorn
- **認証:** OAuth 2.0、Passlib
- **マルチエージェントフレームワーク:** CAMEL

### フロントエンド

- **フレームワーク:** React
- **デスクトップアプリフレームワーク:** Electron
- **言語:** TypeScript
- **UI:** Tailwind CSS、Radix UI、Lucide React、Framer Motion
- **状態管理:** Zustand
- **フローエディター:** React Flow

## 🌟 最新情報を入手 - オープンソース Cowork

> [!IMPORTANT]
>
> **Eigentにスター**を付けると、GitHubからすべてのリリース通知を遅延なく受け取れます ⭐️

![][image-star-us]

## 🗺️ ロードマップ - オープンソース Cowork

私たちのオープンソース Coworkはコミュニティからのフィードバックを取り入れながら進化を続けています。次に予定されている内容は以下の通りです：

| トピック                         | 課題                                                                                                             | Discordチャンネル                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **コンテキストエンジニアリング** | - プロンプトキャッシング<br> - システムプロンプト最適化<br> - ツールキットdocstring最適化<br> - コンテキスト圧縮 | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |
| **マルチモーダル強化**           | - ブラウザ使用時のより正確な画像理解<br> - 高度な動画生成                                                        | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |
| **マルチエージェントシステム**   | - 固定ワークフローをサポートするワークフォース<br> - マルチラウンド変換をサポートするワークフォース              | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |
| **ブラウザツールキット**         | - BrowseComp統合<br> - ベンチマーク改善<br> - 繰り返しページ訪問の禁止<br> - 自動キャッシュボタンクリック        | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |
| **ドキュメントツールキット**     | - 動的ファイル編集のサポート                                                                                     | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |
| **ターミナルツールキット**       | - ベンチマーク改善<br> - Terminal-Bench統合                                                                      | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |
| **環境 & RL**                    | - 環境設計<br> - データ生成<br> - RLフレームワーク統合（VERL、TRL、OpenRLHF）                                    | [**Discordに参加 →**](https://discord.com/invite/CNcNpquyDc) |

## [🤝 コントリビューション][contribution-link]

私たちは信頼を築き、あらゆる形式のオープンソースコラボレーションを歓迎することを信じています。あなたの創造的な貢献が`Eigent`のイノベーションを推進します。GitHubのissuesとプロジェクトを探索して、あなたの力を見せてください 🤝❤️ [コントリビューションガイドライン][contribution-link]

## Contributors

<a href="https://github.com/eigent-ai/eigent/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=eigent-ai/eigent" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

<br>

## [❤️ スポンサー][sponsor-link]

Eigentは[CAMEL-AI.org][camel-ai-org-github]の研究とインフラストラクチャの上に構築されています。[CAMEL-AI.orgをスポンサー][sponsor-link]することで`Eigent`がより良くなります。

## **📄 オープンソースライセンス**

このリポジトリは[Apache License 2.0](LICENSE)の下でライセンスされています。

## 🌐 コミュニティ & お問い合わせ

詳細については info@eigent.ai までお問い合わせください

- **GitHub Issues:** バグ報告、機能リクエスト、開発の追跡。[Issueを提出][github-issue-link]

- **Discord:** リアルタイムサポート、コミュニティとのチャット、最新情報の入手。[参加する](https://discord.com/invite/CNcNpquyDc)

- **X（Twitter）:** 更新情報、AIインサイト、重要なお知らせをフォロー。[フォローする][social-x-link]

- **WeChatコミュニティ:** 以下のQRコードをスキャンしてWeChatアシスタントを追加し、WeChatコミュニティグループに参加してください。

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
