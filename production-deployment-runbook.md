# 本番デプロイ手順

作成日: 2026年6月2日

## 1. 本番URLを決める

推奨は `portal.your-domain.com`。管理者、運用者、クライアントすべて同じURLでログインする。

## 2. ホスティングへデプロイする

このリポジトリはDockerで起動できる。

```bash
npm start
```

本番では `render.yaml` または `Dockerfile` を使ってWebサービスとしてデプロイする。

## 3. 環境変数を設定する

`.env.production.example` を見ながら、ホスティング管理画面に以下を登録する。

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=4173
PUBLIC_URL=https://portal.example.com
FORCE_HTTPS=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_PASSWORD=...
OPERATOR_PASSWORD=...
```

`SUPABASE_SERVICE_ROLE_KEY` は外部に共有しない。クライアント配布資料にも記載しない。

## 4. 独自ドメインを接続する

1. ホスティング側でCustom Domainを追加する。
2. 表示されたDNSレコードをドメイン管理画面へ登録する。
3. SSL証明書が発行済みになるまで待つ。
4. `https://portal.example.com/` にアクセスできることを確認する。

## 5. 公開前チェック

```bash
npm run check
npm run check:prod-env
npm run test:security
npm run test:visibility
npm run backup
```

確認項目:

- 管理者で全社が見える。
- クライアントで自社だけ見える。
- クライアントに更新タブが出ない。
- `https://portal.example.com/api/health` が `ok: true` を返す。
- `SUPABASE_SERVICE_ROLE_KEY` が画面や配布資料に出ていない。

## 6. 配布

- 管理者/運用者: `internal-admin-credentials.md`
- クライアント: `client-distribution-credentials.md` の該当1社分のみ
- URL: `https://portal.example.com/`

## 7. 公開後の運用

- 毎週月曜: 更新タブで受講生データを更新し、保存する。
- 毎月1日: 管理者が「今月を0で開始」を押し、当月売上と当月1000達成だけをリセットする。
- 公開前/大きな更新前: `npm run backup` でバックアップを取る。
