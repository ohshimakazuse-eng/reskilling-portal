# GitHub + Render 公開手順

作成日: 2026年6月2日

## 1. GitHubリポジトリを作る

推奨:

- Repository name: `reskilling-portal`
- Visibility: Private

公開リポジトリにはしない。ログイン/顧客データを扱うため、Privateで運用する。

## 2. ローカルからGitHubへpushする

GitHubで空のPrivate repositoryを作成後、表示されるURLを使って以下を実行する。

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/reskilling-portal.git
git branch -M main
git push -u origin main
```

## 3. RenderでWeb Serviceを作る

1. Renderにログインする。
2. `New +` を押す。
3. `Web Service` を選ぶ。
4. GitHubの `reskilling-portal` を接続する。
5. Environmentは `Docker` を選ぶ。
6. Deployを実行する。

このリポジトリには `render.yaml` と `Dockerfile` が入っているため、Render側でDocker起動できる。

## 4. RenderのEnvironment Variables

RenderのEnvironment画面で以下を登録する。

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `4173` |
| `PUBLIC_URL` | `https://portal.example.com` |
| `FORCE_HTTPS` | `true` |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |
| `ADMIN_PASSWORD` | 管理者ログイン用の本番パスワード |
| `OPERATOR_PASSWORD` | 運用者ログイン用の本番パスワード |

`SUPABASE_SERVICE_ROLE_KEY` は絶対にGitHubへpushしない。

## 5. 独自ドメイン

RenderのWeb Serviceで `Settings > Custom Domains` を開き、使いたいドメインを追加する。

推奨:

```text
portal.your-domain.com
```

Renderに表示されたDNSレコードを、ドメイン管理画面に追加する。SSLはRender側で自動発行される。

## 6. 公開後確認

```bash
curl https://portal.example.com/api/health
```

確認すること:

- `ok: true`
- `storage: supabase`
- `supabase: true`
- `publicUrl` が本番URLになっている

画面確認:

- 管理者ログインで全社が見える
- クライアントログインで自社のみ見える
- クライアントに更新フォームが出ない
- NH/VVはクライアントログインできない
