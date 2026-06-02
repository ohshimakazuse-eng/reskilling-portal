# 本番URL/ドメイン設計

作成日: 2026年6月2日

## 推奨URL

| 用途 | URL | 対象 | 備考 |
| --- | --- | --- | --- |
| 本番ログイン | `https://portal.example.com/` | 管理者 / 運用者 / クライアント | 入口は1つ。ログインID/PWで表示範囲を制御 |
| 稼働確認 | `https://portal.example.com/api/health` | 管理者 / 開発者 | Supabase接続・本番URL確認用 |

## 権限による表示範囲

| ログイン種別 | 見える範囲 | 更新 |
| --- | --- | --- |
| 管理者 | 全社 / NH / VV / クライアント会社 | 可 |
| 運用者 | 全社 / NH / VV / クライアント会社 | 可 |
| クライアント | 自社のみ | 不可 |

## SSL

- 本番URLは必ず `https://` で公開する。
- ホスティング側でSSL証明書を自動発行する。
- `FORCE_HTTPS=true` を設定し、httpアクセスはhttpsへ自動転送する。
- 本番サーバーはHSTSを返すため、ブラウザはhttps接続を優先する。

## DNS

独自ドメインを使う場合は、以下のどちらかで設定する。

| 方式 | 例 | 用途 |
| --- | --- | --- |
| サブドメイン | `portal.your-domain.com` | 推奨。既存サイトと分けやすい |
| ルートドメイン | `your-domain.com` | このサービス専用ドメインにする場合 |

## 環境変数

| 変数 | 値 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | ホスティング側指定。未指定なら `4173` |
| `PUBLIC_URL` | 本番URL。例: `https://portal.example.com` |
| `FORCE_HTTPS` | `true` |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |

## 配布ルール

- 管理者/運用者/クライアントのURLは同じ。
- クライアントには自社のログインID/PWだけ共有する。
- NH/VVは社内管理会社のため、管理者または運用者でログインする。
- URLに会社名や会社IDを入れない。ログイン後に権限で表示を制御する。
