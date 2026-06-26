# DB スキーマ一覧 (Reskill One Portal)

本ドキュメントは、リポジトリ内のDBスキーマ定義を洗い出してまとめたものです。

## ソース

| 項目 | 内容 |
| --- | --- |
| 正式なスキーマ定義 | [`production-db-schema.sql`](../production-db-schema.sql) |
| 行レベルセキュリティ (RLS) | [`production-db-rls.sql`](../production-db-rls.sql) |
| アプリ側のテーブルアクセス定義 | [`supabase-store.mjs`](../supabase-store.mjs)（`tablePlan`／SQLと完全一致） |
| ローカル/正規化ストア | [`normalized-store.mjs`](../normalized-store.mjs)（同じデータモデルのJSON実装） |
| DBエンジン | PostgreSQL 15+ / Supabase 互換（拡張: `pgcrypto`, `citext`） |

- Prisma / `schema.prisma`、`models/`、`migrations/` ディレクトリは **存在しません**。スキーマは生SQLで管理されています。
- テーブルは全12個 + ビュー2個 + ENUM型13個。

> **KPI印の凡例**
> - 📊 = KPI（修了率・登録者数・継続率など）の算出に直接使える列
> - 🔑 = KPI集計時のグルーピング軸（会社・月・ステージなど）になる列

---

## ENUM 型

| 型名 | 値 |
| --- | --- |
| `user_role` | `owner`, `admin`, `operator`, `client_admin`, `client_viewer` |
| `user_status` | `invited`, `active`, `suspended` |
| `company_role` | `operator`, `client_admin`, `client_viewer` |
| `contract_status` | `active`, `paused`, `ended` |
| `company_kind` | `client`, `internal` |
| `member_stage` | `new`, `build`, `pr` |
| `evaluation_status` | `S`, `A`, `B`, `F`, `unrated` |
| `source_kind` | `manual`, `excel`, `google_sheet`, `system` |
| `visibility` | `internal`, `client` |
| `session_type` | `mtg`, `checkin`, `status_report` |
| `session_result` | `focus`, `follow_required`, `done`, `continued` |
| `report_status` | `draft`, `published`, `archived` |

---

## テーブル一覧

### 1. `app_users` — ユーザー（ログインアカウント）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `login_id` | citext | NOT NULL, UNIQUE | | ログインID（大小無視） |
| `name` | text | NOT NULL | | 氏名 |
| `email` | citext | NOT NULL, UNIQUE | | メール（大小無視） |
| `global_role` | user_role | NOT NULL, default `client_viewer` | 🔑 | グローバル権限 |
| `status` | user_status | NOT NULL, default `invited` | 📊 | 在籍状態（active数=アクティブユーザー） |
| `created_at` | timestamptz | NOT NULL, default `now()` | 📊 | 登録日時（登録者数・コホート） |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | 更新トリガーで自動更新 |
| `deleted_at` | timestamptz | | 📊 | 論理削除（NULLが有効ユーザー＝継続率の分母） |

### 2. `companies` — 取引先企業

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `code` | text | NOT NULL, UNIQUE | 🔑 | 企業コード |
| `name` | text | NOT NULL | 🔑 | 企業名 |
| `legal_name` | text | | | 正式名称 |
| `company_kind` | company_kind | NOT NULL, default `client` | 🔑 | client / internal |
| `contract_status` | contract_status | NOT NULL, default `active` | 📊 | 契約状態（active継続=企業単位の継続率） |
| `report_month` | date | NOT NULL, 月初チェック | 🔑 | レポート対象月 |
| `source_file` | text | | | 取込元ファイル |
| `created_at` | timestamptz | NOT NULL, default `now()` | 📊 | 取引開始（新規企業数） |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |
| `deleted_at` | timestamptz | | 📊 | 論理削除（解約判定） |

### 3. `company_users` — 企業×ユーザー（権限割当）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `company_id` | uuid | PK(複合), FK→`companies.id` ON DELETE CASCADE | 🔑 | 企業 |
| `user_id` | uuid | PK(複合), FK→`app_users.id` ON DELETE CASCADE | | ユーザー |
| `role` | company_role | PK(複合), NOT NULL | 🔑 | 企業内ロール |
| `created_at` | timestamptz | NOT NULL, default `now()` | | |

- 複合主キー `(company_id, user_id, role)` / INDEX `company_users(user_id)`

### 4. `members` — 受講メンバー（KPIの中核テーブル）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `company_id` | uuid | NOT NULL, FK→`companies.id` ON DELETE CASCADE | 🔑 | 所属企業 |
| `display_name` | text | NOT NULL | | 表示名 |
| `normalized_name` | text | NOT NULL | | 正規化名（重複判定用） |
| `stage` | member_stage | NOT NULL, default `build` | 📊🔑 | 育成ステージ（new/build/pr）= ステージ別人数・遷移率 |
| `evaluation_status` | evaluation_status | NOT NULL, default `unrated` | 📊 | 評価ランク（S/A/B/F）= 評価分布 |
| `progress_percent` | smallint | NOT NULL, default 0, CHECK 0–100 | 📊 | 進捗率（平均進捗・修了率の素データ） |
| `client_memo` | text | | | クライアント向けメモ |
| `internal_memo` | text | | | 社内メモ |
| `active` | boolean | NOT NULL, default true | 📊 | 稼働中フラグ（継続率の分子/分母） |
| `source_ref` | jsonb | NOT NULL, default `{}` | | 取込元参照 |
| `created_at` | timestamptz | NOT NULL, default `now()` | 📊 | 登録日（登録者数・コホート起点） |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |
| `deleted_at` | timestamptz | | 📊 | 論理削除（離脱＝継続率算出に使用） |

- UNIQUE `(company_id, normalized_name) WHERE deleted_at IS NULL`
- INDEX `(company_id, stage)`, `(company_id, evaluation_status)`（いずれも `deleted_at IS NULL`）

### 5. `milestone_definitions` — マイルストーン定義（マスタ）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `key` | text | PK | 🔑 | マイルストーンキー |
| `label` | text | NOT NULL | | 表示ラベル |
| `group_key` | text | NOT NULL | 🔑 | グループ（prerequisite/build/follower/pr/result） |
| `sort_order` | integer | NOT NULL, UNIQUE | | 表示順 |
| `active` | boolean | NOT NULL, default true | | 有効フラグ |

- 初期データ23件投入（毎日投稿/Q&A/MTG/オリエン/フォロワー100〜1000/PR各種/月1〜100件獲得 など）。
- `month1`〜`month100`（月次獲得件数）や `f100`〜`f1000`（フォロワー到達）は **修了率・到達率KPI** の達成基準として利用可能。

### 6. `member_milestones` — メンバー×マイルストーン達成状況

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `member_id` | uuid | PK(複合), FK→`members.id` ON DELETE CASCADE | 🔑 | メンバー |
| `milestone_key` | text | PK(複合), FK→`milestone_definitions.key` | 🔑 | マイルストーン |
| `done` | boolean | NOT NULL, default false | 📊 | 達成フラグ（修了率・達成率の分子） |
| `achieved_at` | timestamptz | CHECK `done or achieved_at is null` | 📊 | 達成日時（達成までの所要日数） |
| `updated_by` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 更新者 |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |

- 複合主キー `(member_id, milestone_key)` / INDEX `(milestone_key, done)`

### 7. `member_accounts` — メンバーのSNSアカウント

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `member_id` | uuid | NOT NULL, FK→`members.id` ON DELETE CASCADE | 🔑 | メンバー |
| `slot` | smallint | NOT NULL, CHECK in (1,2) | | アカウント枠 |
| `platform` | text | NOT NULL, default `tiktok` | 🔑 | プラットフォーム |
| `handle` | text | | | ハンドル名 |
| `url` | text | | | URL |
| `account_stage` | member_stage | | 📊 | アカウント単位ステージ |
| `active` | boolean | NOT NULL, default true | 📊 | 稼働中 |
| `source_ref` | jsonb | NOT NULL, default `{}` | | 取込元参照 |
| `created_at` | timestamptz | NOT NULL, default `now()` | | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |

- CHECK: `url` または `handle` のいずれか必須
- UNIQUE `(member_id, slot)` / INDEX `url WHERE url IS NOT NULL`

### 8. `member_metrics` — メンバー月次メトリクス（数値KPIの素データ）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `member_id` | uuid | PK(複合), FK→`members.id` ON DELETE CASCADE | 🔑 | メンバー |
| `metric_month` | date | PK(複合), 月初チェック | 🔑 | 対象月（時系列軸） |
| `follower_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | フォロワー数（成長率） |
| `sales_amount` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | 売上額 |
| `deals_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | 成約件数 |
| `source_kind` | source_kind | NOT NULL, default `manual` | | 取込種別 |
| `source_ref` | jsonb | NOT NULL, default `{}` | | 取込元参照 |
| `updated_by` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 更新者 |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |

- 複合主キー `(member_id, metric_month)` / INDEX `(metric_month)`

### 9. `coaching_sessions` — コーチング/MTG履歴

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `company_id` | uuid | NOT NULL, FK→`companies.id` ON DELETE CASCADE | 🔑 | 企業 |
| `member_id` | uuid | NOT NULL, FK→`members.id` ON DELETE CASCADE | 🔑 | メンバー |
| `occurred_on` | date | NOT NULL | 📊🔑 | 実施日（実施回数・頻度KPI） |
| `session_type` | session_type | NOT NULL, default `mtg` | 🔑 | 種別（mtg/checkin/status_report） |
| `result` | session_result | NOT NULL, default `continued` | 📊 | 結果（continued=継続、フォロー要否） |
| `coach_name` | text | | | コーチ名 |
| `content` | text | NOT NULL | | 内容 |
| `next_action` | text | | | 次回アクション |
| `visibility` | visibility | NOT NULL, default `client` | | 公開範囲 |
| `source_kind` | source_kind | NOT NULL, default `manual` | | 取込種別 |
| `source_ref` | jsonb | NOT NULL, default `{}` | | 取込元参照 |
| `created_by` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 作成者 |
| `created_at` | timestamptz | NOT NULL, default `now()` | | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |
| `deleted_at` | timestamptz | | | 論理削除 |

- INDEX `(company_id, occurred_on desc)`, `(member_id, occurred_on desc)`（いずれも `deleted_at IS NULL`）

### 10. `company_monthly_summaries` — 企業月次サマリ（集計済みKPIテーブル）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `company_id` | uuid | PK(複合), FK→`companies.id` ON DELETE CASCADE | 🔑 | 企業 |
| `summary_month` | date | PK(複合), 月初チェック | 🔑 | 対象月 |
| `enrollment_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | **登録者数** |
| `new_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | newステージ人数 |
| `build_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | buildステージ人数 |
| `pr_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | prステージ人数 |
| `avg_progress_percent` | numeric(5,2) | NOT NULL, default 0 | 📊 | **平均進捗率**（修了率の代理指標） |
| `total_sales_amount` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | 売上合計 |
| `risk_member_count` | integer | NOT NULL, default 0, CHECK ≥0 | 📊 | リスクメンバー数（離脱/継続率） |
| `source_kind` | source_kind | NOT NULL, default `system` | | 取込種別 |
| `source_ref` | jsonb | NOT NULL, default `{}` | | 取込元参照 |
| `calculated_at` | timestamptz | NOT NULL, default `now()` | | 集計日時 |

- 複合主キー `(company_id, summary_month)` / INDEX `(summary_month desc)`
- **このテーブルが登録者数・ステージ分布・継続率の主要な月次KPIソース。**

### 11. `client_reports` — クライアント向けレポート

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `company_id` | uuid | NOT NULL, FK→`companies.id` ON DELETE CASCADE | 🔑 | 企業 |
| `report_month` | date | NOT NULL, 月初チェック | 🔑 | 対象月 |
| `executive_summary` | text | | | 総括 |
| `progress_good_text` | text | NOT NULL, default `''` | | 進捗良好点 |
| `field_issue_text` | text | NOT NULL, default `''` | | 現場課題 |
| `operator_action_text` | text | NOT NULL, default `''` | | 運営アクション |
| `client_request_text` | text | NOT NULL, default `''` | | クライアント依頼 |
| `focus_points` | jsonb | NOT NULL, default `[]` | | 注力ポイント |
| `wins` | jsonb | NOT NULL, default `[]` | | 成果 |
| `risks` | jsonb | NOT NULL, default `[]` | 📊 | リスク（継続率の定性情報） |
| `requests_to_client` | jsonb | NOT NULL, default `[]` | | 依頼事項 |
| `source_kind` | source_kind | NOT NULL, default `manual` | | 取込種別 |
| `source_ref` | jsonb | NOT NULL, default `{}` | | 取込元参照 |
| `status` | report_status | NOT NULL, default `draft` | 📊 | 状態（published率） |
| `published_at` | timestamptz | | 📊 | 公開日時 |
| `confirmed_at` | timestamptz | | 📊 | クライアント確認日時 |
| `created_by` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 作成者 |
| `updated_by` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 更新者 |
| `created_at` | timestamptz | NOT NULL, default `now()` | | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | | |

- UNIQUE `(company_id, report_month)` / INDEX `(company_id, status, report_month desc)`

### 12. `update_batches` — 更新バッチ（監査用）

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `company_id` | uuid | FK→`companies.id` ON DELETE SET NULL | 🔑 | 企業 |
| `actor_id` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 実行者 |
| `summary` | text | NOT NULL | | 概要 |
| `status` | text | NOT NULL, default `committed`, CHECK in (committed, reverted) | | 状態 |
| `created_at` | timestamptz | NOT NULL, default `now()` | | |

- INDEX `(company_id, created_at desc)`

### 13. `audit_logs` — 監査ログ

| カラム | 型 | 制約・既定値 | KPI | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | PK, default `gen_random_uuid()` | | 主キー |
| `batch_id` | uuid | FK→`update_batches.id` ON DELETE SET NULL | | バッチ |
| `actor_id` | uuid | FK→`app_users.id` ON DELETE SET NULL | | 実行者 |
| `company_id` | uuid | FK→`companies.id` ON DELETE SET NULL | 🔑 | 企業 |
| `target_type` | text | NOT NULL | | 対象種別 |
| `target_id` | uuid | | | 対象ID |
| `action` | text | NOT NULL | | アクション |
| `before_json` | jsonb | | | 変更前 |
| `after_json` | jsonb | | | 変更後 |
| `created_at` | timestamptz | NOT NULL, default `now()` | | |

- INDEX `(company_id, created_at desc)`, `(target_type, target_id, created_at desc)`

---

## ビュー

### `company_dashboard_latest`
企業ごとに最新の月次サマリ（`company_monthly_summaries`）と最新の有効レポート（`client_reports` で status が draft/published）を結合。`deleted_at IS NULL` の企業のみ。
- 📊 公開フィールド: `enrollment_count`, `new_count`, `build_count`, `pr_count`, `avg_progress_percent`, `total_sales_amount`, `risk_member_count` — **ダッシュボードのKPI表示の直接ソース。**

### `member_current_metrics`
メンバーごとに最新月の `member_metrics`（`follower_count`, `sales_amount`, `deals_count`）を1行に集約（`DISTINCT ON (member.id)`）。
- 📊 メンバー単位の最新フォロワー数・売上・成約件数。

---

## リレーション図（概念）

```
app_users ──< company_users >── companies
                                   │
                                   ├──< members ──< member_milestones >── milestone_definitions
                                   │        ├──< member_accounts
                                   │        ├──< member_metrics
                                   │        └──< coaching_sessions
                                   ├──< company_monthly_summaries
                                   ├──< client_reports
                                   ├──< coaching_sessions
                                   ├──< update_batches ──< audit_logs
                                   └──< audit_logs
```

- `app_users` は `member_milestones.updated_by` / `member_metrics.updated_by` / `coaching_sessions.created_by` / `client_reports.created_by,updated_by` / `update_batches.actor_id` / `audit_logs.actor_id` からも参照される（ON DELETE SET NULL）。

---

## KPI算出ガイド（主要列まとめ）

| KPI | 推奨ソース列 |
| --- | --- |
| **登録者数** | `company_monthly_summaries.enrollment_count`、または `members.created_at` を月別カウント |
| **修了率 / 達成率** | `member_milestones.done`（特に `month1`〜`month100`・`f100`〜`f1000` キー）/ `members.progress_percent` / `avg_progress_percent` |
| **継続率** | `members.active` × `members.deleted_at`、`companies.contract_status`、`company_monthly_summaries.risk_member_count`、`coaching_sessions.result`（continued） |
| **ステージ分布** | `members.stage`、`company_monthly_summaries.new_count/build_count/pr_count` |
| **成長/売上** | `member_metrics.follower_count/sales_amount/deals_count`、`company_monthly_summaries.total_sales_amount` |
| **評価分布** | `members.evaluation_status`（S/A/B/F/unrated） |
| **コーチング活動量** | `coaching_sessions.occurred_on`（実施回数・頻度） |
