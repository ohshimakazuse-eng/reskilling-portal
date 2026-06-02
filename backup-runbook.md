# バックアップ / 復元 / スプシ再同期 運用手順

作成日: 2026年6月2日

## 実装済みの保険

### 1. DBバックアップ

`backup_supabase.mjs`

Supabaseの本番DBを全テーブルJSONで保存する。

対象テーブル:

- app_users
- companies
- company_users
- members
- member_accounts
- member_milestones
- member_metrics
- coaching_sessions
- company_monthly_summaries
- client_reports
- update_batches
- audit_logs

保存先:

`backups/<日時>/`

含まれるもの:

- `supabase-normalized-db.json`
- `audit-logs.json`
- `update-batches.json`
- `manifest.json`
- `data.js`
- `data-summary.json`
- `google_sheets_xlsx/*.xlsx`
- 最新同期/照合レポート

## 2. バックアップ検証

`verify_backup.mjs <backup_dir>`

確認内容:

- 必須ファイルが存在するか
- テーブルスナップショットが存在するか
- 件数がmanifestと一致するか
- DB JSONのSHA256が一致するか
- audit_logs件数が一致するか

## 3. 復元

`restore_supabase_backup.mjs <backup_dir>`

通常実行はドライラン。

```bash
node restore_supabase_backup.mjs backups/2026-06-02T11-14-20-926Z
```

実データは変更されない。

本当に復元する場合:

```bash
node restore_supabase_backup.mjs backups/2026-06-02T11-14-20-926Z --confirm-restore
```

DBをバックアップ時点と完全に合わせたい場合:

```bash
node restore_supabase_backup.mjs backups/2026-06-02T11-14-20-926Z --confirm-restore --replace
```

注意:

- `--confirm-restore` がない限りDBは変更されない。
- `--replace` は全置換なので、使用前に必ず最新バックアップを作る。
- 復元実行時は `audit_logs` に `restore_full_backup` が残る。

## 4. スプシから再同期できる保険

`safe_resync_from_sheets.mjs`

処理順:

1. Supabase本番DBをバックアップ
2. Googleスプシ17社分をxlsxで再ダウンロード
3. `sync_from_xlsx.py` で `data.js` を再生成
4. Supabaseへ反映
5. スプシ正本と平台データを照合
6. 権限テスト
7. クライアント表示範囲テスト
8. 実行結果を `backups/resync-runs/` に保存

このコマンドは、再同期前に必ずバックアップを作る。

## 5. 最新実行結果

最新バックアップ:

`backups/2026-06-02T11-14-20-926Z`

バックアップ検証:

- OK
- 会社: 17
- DB上のmembers全件: 392
- audit_logs: 68
- update_batches: 3
- スプシxlsx: 17ファイル

スプシ再同期:

- OK
- 正本会社数: 17
- 有効受講生数: 382
- 売上: 2,391,000円
- mismatchCount: 0

権限テスト:

- OK

クライアント表示範囲テスト:

- OK

## 6. HTTP配信ブロック

以下はURL直打ちで見えないよう403にしている。

- `backups/`
- `db/`
- `google_sheets_xlsx/`
- `.json`
- `.ndjson`
- `.mjs`
- `.py`
- `.sql`
- `.xlsx`
- `.csv`
- `.md`

確認済み:

- `/backups/.../manifest.json`: 403
- `/backups/.../supabase-normalized-db.json`: 403
- `/db/platform-db.json`: 403
- `/google_sheets_xlsx/NH.xlsx`: 403
- `/data-summary.json`: 403

## 7. 障害時の戻し方

### 誤更新した場合

1. まずバックアップ作成。
2. `audit_logs` で対象更新を確認。
3. 会社単位なら `restore_from_audit_log.mjs <audit_log_id>` をドライラン確認後に使う。
4. 全体を戻す必要がある場合は `restore_supabase_backup.mjs <backup_dir>` でドライラン。
5. 問題なければ `--confirm-restore` を付けて復元。

### スプシを正として戻す場合

`safe_resync_from_sheets.mjs` を使う。

このコマンドは実行前に必ずバックアップを作るため、再同期でズレても直前状態に戻せる。
