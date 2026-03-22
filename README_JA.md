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
- ✅ **エンタープライズ機能** - SSO/アクセス制御
- ✅ **ローカルデプロイメント**
- ✅ **オープンソース**
- ✅ **カスタムモデルサポート**
- ✅ **MCP統合**

<br/>

[![][image-join-us]][join-us]

<details>
<summary><kbd>目次</kbd></summary>

#### TOC

- \[🚀 はじめに - オープンソース Cowork\](#-はじめに---オープンソース Cowork)
  - [🏠 ローカルデプロイメント（推奨）](#-%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E3%83%A1%E3%83%B3%E3%83%88%E6%8E%A8%E5%A5%A8)
  - [⚡ クイックスタート（クラウド接続）](#-%E3%82%AF%E3%82%A4%E3%83%83%E3%82%AF%E3%82%B9%E3%82%BF%E3%83%BC%E3%83%88%E3%82%AF%E3%83%A9%E3%82%A6%E3%83%89%E6%8E%A5%E7%B6%9A)
  - [🏢 エンタープライズ](#-%E3%82%A8%E3%83%B3%E3%82%BF%E3%83%BC%E3%83%97%E3%83%A9%E3%82%A4%E3%82%BA)
  - [☁️ クラウドバージョン](#%EF%B8%8F-%E3%82%AF%E3%83%A9%E3%82%A6%E3%83%89%E3%83%90%E3%83%BC%E3%82%B8%E3%83%A7%E3%83%B3)
- \[✨ 主な機能 - オープンソース Cowork\](#-主な機能---オープンソース Cowork)
  - [🏭 ワークフォース](#-%E3%83%AF%E3%83%BC%E3%82%AF%E3%83%95%E3%82%A9%E3%83%BC%E3%82%B9)
  - [🧠 包括的なモデルサポート](#-%E5%8C%85%E6%8B%AC%E7%9A%84%E3%81%AA%E3%83%A2%E3%83%87%E3%83%AB%E3%82%B5%E3%83%9D%E3%83%BC%E3%83%88)
  - [🔌 MCPツール統合](#-mcp%E3%83%84%E3%83%BC%E3%83%AB%E7%B5%B1%E5%90%88)
  - [✋ ヒューマンインザループ](#-%E3%83%92%E3%83%A5%E3%83%BC%E3%83%9E%E3%83%B3%E3%82%A4%E3%83%B3%E3%82%B6%E3%83%AB%E3%83%BC%E3%83%97)
  - [👐 100%オープンソース](#-100%E3%82%AA%E3%83%BC%E3%83%97%E3%83%B3%E3%82%BD%E3%83%BC%E3%82%B9)
- \[🧩 ユースケース - オープンソース Cowork\](#-ユースケース---オープンソース Cowork)
- [🛠️ 技術スタック](#%EF%B8%8F-%E6%8A%80%E8%A1%93%E3%82%B9%E3%82%BF%E3%83%83%E3%82%AF)
  - [バックエンド](#%E3%83%90%E3%83%83%E3%82%AF%E3%82%A8%E3%83%B3%E3%83%89)
  - [フロントエンド](#%E3%83%95%E3%83%AD%E3%83%B3%E3%83%88%E3%82%A8%E3%83%B3%E3%83%89)
- \[🌟 最新情報を入手 - オープンソース Cowork\](#最新情報を入手---オープンソース Cowork)
- \[🗺️ ロードマップ - オープンソース Cowork\](#️-ロードマップ---オープンソース Cowork)
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

📧 詳細については、[info@eigent.ai](mailto:info@eigent.ai) までお問い合わせください。

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

Eigentのオープンソース Coworkの強力な機能で卓越した生産性の可能性を最大限に引き出しましょう — シームレスな統合、よりスマートなタスク実行、無限の自動化のために構築されています。

### 🏭 ワークフォース

複雑なタスクを解決するために協力する専門AIエージェントのチームを活用します。Eigentのオープンソース Coworkは動的にタスクを分解し、複数のエージェントを**並列で**動作させます。

Eigentは以下のエージェントワーカーを事前定義しています：

- **Developer Agent:** コードを書いて実行し、ターミナルコマンドを実行します。
- **Browser Agent:** ウェブを検索し、コンテンツを抽出します。
- **Document Agent:** ドキュメントを作成・管理します。
- **Multi-Modal Agent:** 画像と音声を処理します。

![Workforce](https://eigent-ai.github.io/.github/assets/gif/feature_dynamic_workforce.gif)

<br/>

### 🧠 包括的なモデルサポート

お好みのモデルでEigent オープンソース Coworkデスクトップをローカルにデプロイできます。

![Model](https://eigent-ai.github.io/.github/assets/gif/feature_local_model.gif)

<br/>

### 🔌 MCPツール統合

Eigentには大規模な組み込み\*\*Model Context Protocol（MCP）\*\*ツール（ウェブブラウジング、コード実行、Notion、Google suite、Slackなど）が付属しており、**独自のツールをインストール**することもできます。エージェントにシナリオに適したツールを装備させ、内部APIやカスタム関数を統合して機能を強化できます。

![MCP](https://eigent-ai.github.io/.github/assets/gif/feature_add_mcps.gif)

<br/>

### ✋ ヒューマンインザループ

タスクが行き詰まったり不確実性に遭遇した場合、Eigentは自動的に人間の入力を要求します。

![Human-in-the-loop](https://eigent-ai.github.io/.github/assets/gif/feature_human_in_the_loop.gif)

<br/>

### 👐 100%オープンソース

Eigentは完全にオープンソースです。コードをダウンロード、検査、修正でき、透明性を確保し、マルチエージェントイノベーションのためのコミュニティ主導のエコシステムを育成します。

![Opensource][image-opensource]

<br/>

## 🧩 ユースケース - オープンソース Cowork

世界中の開発者がEigentのオープンソース Cowork機能を活用して、さまざまな業界で複雑なワークフローを自動化し、生産性を向上させている方法をご覧ください。

### 1. パームスプリングステニス旅行の旅程とSlackサマリー [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTM0MzUxNTEzMzctNzExMyI.aIeysw.MUeG6ZcBxI1GqvPDvn4dcv-CDWw__1753435151337-7113)

<details>
<summary><strong>プロンプト:</strong> <kbd>私たちは2人のテニスファンで、パームスプリングス2026のテニストーナメントを見に行きたいです...</kbd></summary>
<br>
私たちは2人のテニスファンで、パームスプリングス2026のテニストーナメントを見に行きたいです。私はサンフランシスコに住んでいます。準決勝/決勝の時期に合わせて、3日間のフライト、ホテル、アクティビティを含む詳細な旅程を準備してください。私たちはハイキング、ヴィーガン料理、スパが好きです。予算は5,000ドルです。旅程は、時間、アクティビティ、コスト、その他の詳細、および該当する場合はチケット購入/予約リンクを含む詳細なタイムラインにしてください。スパへのアクセスはあれば嬉しいですが、必須ではありません。このタスクが完了したら、この旅行に関するHTMLレポートを生成し、計画の要約とレポートHTMLリンクをSlackの#tennis-trip-sfチャンネルに送信してください。
</details>

<br>

### 2. CSVバンクデータからQ2レポートを生成 [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTM1MjY4OTE4MDgtODczOSI.aIjJmQ.WTdoX9mATwrcBr_w53BmGEHPo8U__1753526891808-8739)

<details>
<summary><strong>プロンプト:</strong> <kbd>銀行振込記録ファイルに基づいてQ2財務諸表を準備してください...</kbd></summary>
<br>
デスクトップにあるbank_transacation.csvの銀行振込記録ファイルに基づいて、投資家向けに支出額をチャート付きHTMLレポートにまとめたQ2財務諸表を準備してください。
</details>

<br>

### 3. 英国ヘルスケア市場調査レポートの自動化 [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTMzOTM1NTg3OTctODcwNyI.aIey-Q.Jh9QXzYrRYarY0kz_qsgoj3ewX0__1753393558797-8707)

<details>
<summary><strong>プロンプト:</strong> <kbd>次の会社の計画をサポートするために、英国のヘルスケア業界を分析してください...</kbd></summary>
<br>
次の会社の計画をサポートするために、英国のヘルスケア業界を分析してください。現在のトレンド、成長予測、関連規制を含む包括的な市場概要を提供してください。市場内の主要な機会、ギャップ、またはサービスが行き届いていないセグメントのトップ5-10を特定してください。すべての調査結果を、よく構成されたプロフェッショナルなHTMLレポートで提示してください。その後、タスクが完了したらSlackの#eigentr-product-testチャンネルにメッセージを送信し、チームメイトとレポート内容を共有してください。
</details>

<br>

### 4. ドイツの電動スケートボード市場実現可能性調査 [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTM2NTI4MjY3ODctNjk2Ig.aIjGiA.t-qIXxk_BZ4ENqa-yVIm0wMVyXU__1753652826787-696)

<details>
<summary><strong>プロンプト:</strong> <kbd>私たちは高級電動スケートボードを製造する会社で、ドイツ市場への参入を検討しています...</kbd></summary>
<br>
私たちは高級電動スケートボードを製造する会社で、ドイツ市場への参入を検討しています。詳細な市場参入実現可能性レポートを準備してください。レポートは以下の側面をカバーする必要があります：
1. 市場規模と規制：ドイツにおける個人用軽量電動車両（PLEV）の市場規模、年間成長率、主要プレーヤー、市場シェアを調査してください。同時に、ABE認証などの認証要件や保険ポリシーを含む、公道での電動スケートボード使用に関するドイツの法律と規制の詳細な内訳と要約を提供してください。
2. 消費者プロファイル：潜在的なドイツの消費者のプロファイルを分析してください。年齢、収入レベル、主な使用シナリオ（通勤、レクリエーション）、主な購買決定要因（価格、性能、ブランド、デザイン）、情報収集に使用するチャネル（フォーラム、ソーシャルメディア、オフライン小売店）を含めてください。
3. チャネルと流通：ドイツの主流オンライン電子機器販売プラットフォーム（Amazon.de、MediaMarkt.deなど）と高級スポーツ用品オフライン小売チェーンを調査してください。潜在的なオンラインおよびオフライン流通パートナーのトップ5をリストアップし、可能であれば購買部門の連絡先情報を見つけてください。
4. コストと価格設定：デスクトップのProduct_Cost.csvファイルにある製品コスト構造に基づき、ドイツの関税、付加価値税（VAT）、物流・倉庫コスト、潜在的なマーケティング費用を考慮して、メーカー希望小売価格（MSRP）を見積もり、市場での競争力を分析してください。
5. 包括的なレポートとプレゼンテーション：すべての調査結果をHTMLレポートファイルにまとめてください。内容にはデータチャート、主要な調査結果、最終的な市場参入戦略の推奨（推奨/非推奨/条件付き推奨）を含めてください。
</details>

<br>

### 5. Workforce Multiagentローンチ向けSEO監査 [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTM2OTk5NzExNDQtNTY5NiI.aIex0w.jc_NIPmfIf9e3zGt-oG9fbMi3K4__1753699971144-5696)

<details>
<summary><strong>プロンプト:</strong> <kbd>新しいWorkforce Multiagent製品のローンチをサポートするために...</kbd></summary>
<br>
新しいWorkforce Multiagent製品のローンチをサポートするために、公式ウェブサイト（https://www.camel-ai.org/）で徹底的なSEO監査を実行し、実行可能な推奨事項を含む詳細な最適化レポートを提供してください。
</details>

<br>

### 6. ダウンロード内の重複ファイルを特定 [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTM3NjAzODgxNzEtMjQ4Ig.aIhKLQ.epOG--0Nj0o4Bqjtdqm9OZdaqRQ__1753760388171-248)

<details>
<summary><strong>プロンプト:</strong> <kbd>Documentsディレクトリにmydocsというフォルダがあります...</kbd></summary>
<br>
Documentsディレクトリにmydocsというフォルダがあります。スキャンして、完全一致または類似した重複ファイルをすべて特定してください — ファイル名や拡張子が異なっていても、同一のコンテンツ、ファイルサイズ、または形式を持つファイルを含みます。類似性でグループ化して明確にリストしてください。
</details>

<br>

### 7. PDFに署名を追加 [リプレイ ▶️](https://www.eigent.ai/download?share_token=IjE3NTQwOTU0ODM0NTItNTY2MSI.aJCHrA.Mg5yPOFqj86H_GQvvRNditzepXc__1754095483452-5661)

<details>
<summary><strong>プロンプト:</strong> <kbd>この署名画像をPDFの署名エリアに追加してください...</kbd></summary>
<br>
この署名画像をPDFの署名エリアに追加してください。このタスクを完了するために、CLIツール'tesseract'（OCRを介した'署名エリア'の信頼性の高い位置特定に必要）をインストールできます。
</details>

<br>

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
[join-us]: https://eigent-ai.notion.site/eigent-ai-careers
[join-us-image]: https://img.shields.io/badge/Join%20Us-yellow?style=plastic
[reddit-image]: https://img.shields.io/reddit/subreddit-subscribers/CamelAI?style=plastic&logo=reddit&label=r%2FCAMEL&labelColor=white
[reddit-url]: https://www.reddit.com/r/CamelAI/
[social-x-link]: https://x.com/Eigent_AI
[social-x-shield]: https://img.shields.io/badge/-%40Eigent_AI-white?labelColor=gray&logo=x&logoColor=white&style=plastic
[sponsor-link]: https://github.com/sponsors/camel-ai
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20CAMEL--AI-1d1d1d?logo=github&logoColor=white&style=plastic
[wechat-image]: https://img.shields.io/badge/WeChat-CamelAIOrg-brightgreen?logo=wechat&logoColor=white
[wechat-url]: https://ghli.org/camel/wechat.png
