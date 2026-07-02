# Reskilling Portal (Next Ramp)

法人向けリスキリング事業(TikTok運用研修)の進捗可視化プラットフォーム。
17社・約390名の受講生の進捗・マイルストーン・売上を管理し、クライアント企業は自社分のみ閲覧できる。

## 構成

- フロント+API一体のNode.jsシングルサーバー(`server.mjs`、フレームワークなし・依存ゼロ)
- フロントは素のJS/HTML/CSS(`app.js` / `index.html` / `styles.css`、ビルドなし)
- DB: Supabase(本番) / `data.js` はスプシ正本から生成される全社データのバンドル(約15,000行、直接編集しない)
- ホスティング: Render + Docker(`render.yaml` / `Dockerfile`)
- スプレッドシート17社分が**正本**。ポータルはその可視化先

## ロール

- 管理者(admin): 全社閲覧+更新+月次リセット
- 運用者(operator): 全社閲覧+更新
- クライアント(company_users): 自社のみ閲覧。更新タブ・他社情報は見えてはいけない

## コマンド

```bash
npm run check            # 構文チェック(server.mjs / app.js / stores)
npm run check:prod-env   # 本番環境変数チェック
npm run test:security    # 権限テスト(要: サーバー起動)
npm run test:visibility  # クライアント表示範囲テスト(要: サーバー起動)
npm run backup           # Supabase本番の全テーブルバックアップ(要: 本番認証情報)
node scripts/company_stats.mjs   # 実績集計(読み取り専用、ローカルで完結)
```

## 業務用Skill

- `/sales-deck` — 営業資料ドラフト生成(実績集計→構成→Canva)
- `/monthly-report` — クライアント向け月次進捗報告ドラフト生成
- `/weekly-ops` — 週次更新の事前・事後検証と差分レポート

## 変更時の必須ルール

1. 変更後は必ず `npm run check` を通す
2. 権限まわり(session / role / visibility)を触ったら `test:security` と `test:visibility` を必ず実行
3. クライアントに他社情報が漏れる変更は絶対にしない(表示系の変更時は visibility テストで確認)
4. Supabase egress を増やさない(過去にクォータ制限の障害あり。全件フェッチ・ポーリング追加は要注意 — コミット 1220834 参照)
5. `data.js` は生成物。手で編集せず、スプシ再同期で更新する

## 危険操作(必ずユーザーの明示承認を得る)

- `restore_supabase_backup.mjs --confirm-restore` / `--replace`(本番DB復元・全置換)
- 本番Supabaseへの書き込み全般(`sync_latest_sheets_to_platform.mjs` 含む)
- Renderへのデプロイ設定変更

## 秘密情報(コミット禁止)

- Supabase Service Role Key、ADMIN/OPERATOR パスワード
- ログインID/PW配布表、`backups/`、スプシ原本、ローカルDB
