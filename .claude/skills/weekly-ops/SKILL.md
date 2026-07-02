---
name: weekly-ops
description: 毎週月曜の受講生データ更新(スプシ→ポータル)の運用を支援する。更新前後のバックアップ・検証・照合レポートまで。「週次更新」「月曜の更新」「データ同期のチェック」と言われたら使う。
---

# 週次更新オペレーション支援

毎週月曜にスプレッドシート(17社分)の内容をポータルへ反映する運用の、事前準備・事後検証を支援する。
実際の更新作業は従業員がポータルの更新タブ、またはローカル同期スクリプトで行う。

## このSkillがやること / やらないこと

- やる: バックアップ確認、更新前後の件数照合、テスト実行、差分レポート作成
- やらない: 本番DBへの直接書き込み、スプシの書き換え(これらは必ず人間が実行)

## 手順

### 1. 更新前チェック

```bash
npm run check          # 構文チェック
node scripts/company_stats.mjs > /tmp/stats_before.md   # 更新前スナップショット
```

バックアップの新しさを確認する。`backups/` 配下の最新ディレクトリが7日以上前なら、
**更新作業の前に `npm run backup` の実行を担当者に依頼する**(このSkillが勝手に実行しない。
バックアップは読み取り専用だが、本番Supabaseへのアクセスと通信量が発生するため)。

### 2. 従業員の更新作業(人間)

`ops/weekly-update-checklist.md` のチェックリストに沿って実施してもらう。

### 3. 更新後検証

```bash
node scripts/company_stats.mjs > /tmp/stats_after.md
diff /tmp/stats_before.md /tmp/stats_after.md
```

ローカルにサーバーが起動できる環境なら追加で:

```bash
npm run test:security    # 権限テスト
npm run test:visibility  # クライアント表示範囲テスト
```

### 4. 差分レポートを作る

before/after の差分から以下を1枚のMarkdownにまとめて報告する:

- 会社別の受講生数の増減(±3名以上の変動は「要確認」として明示)
- 売上合計の変化
- 要フォロー・要対応MTGの増減
- 明らかにおかしい変化(全員0になった、1社消えた等)があれば**赤字で警告し、復元手順(backup-runbook.md)を案内**

## 異常時の対応

データが壊れた疑いがある場合は、自分で修復しようとせず:

1. `backup-runbook.md` の「障害時の戻し方」をユーザーに提示
2. `restore_supabase_backup.mjs` はまずドライラン(引数なし)を案内
3. `--confirm-restore` / `--replace` 付き実行は**必ずユーザーの明示承認後**
