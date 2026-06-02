# Reskilling Portal

法人向けリスキリング事業の進捗可視化プラットフォームです。

## 本番構成

- Frontend / API: Node.js single server
- Database: Supabase
- Hosting: Render + Docker
- URL: `https://portal.example.com/`

## 起動

```bash
npm start
```

## 本番環境変数

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

## チェック

```bash
npm run check
npm run check:prod-env
npm run test:security
npm run test:visibility
```

## 重要

以下はGitHubへ上げない。

- Supabase Service Role Key
- ログインID/PW配布表
- ローカルDB
- バックアップ
- スプレッドシート原本
