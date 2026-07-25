-- 受講生の実績を「実際の月」に付け替える移行SQL
--
-- 背景:
--   修正前のアプリは member_metrics に会社の report_month(多くは 2026-06-01) の1行だけを持ち、
--   保存のたびに同じ行を上書きしていた。そのため現在入っている数字は「最新値」であって
--   6月の実績ではない。6月時点の受講生ごとの数字はどこにも記録されていないため復元できない。
--
-- このSQLがすること:
--   1. 実行前の member_metrics 全体を退避テーブルへ保存する（いつでも戻せる）
--   2. 各受講生の「現在入っている数字」(7月より前の最新行) を 2026-07-01 の実績として付け替える
--      - すでに 2026-07-01 の行がある場合は、修正版デプロイ後に入力された本物の7月実績なので上書きしない
--   3. 7月より前の行を削除し、6月以前を「未登録」にする
--
-- 冪等: 何度実行しても結果は変わらない。
-- 検証: PostgreSQL 16 + production-db-schema.sql に対して実行済み。

begin;

-- 0) 退避（いつでも元に戻せるようにする）
create table if not exists member_metrics_backup_20260725 as
select * from member_metrics;

-- 1) 現在入っている数字を 2026-07-01 の実績として付け替える
with current_value as (
  select distinct on (member_id)
         member_id, follower_count, sales_amount, deals_count, source_kind, source_ref, updated_at
  from member_metrics
  where metric_month < date '2026-07-01'
  order by member_id, metric_month desc, updated_at desc
)
insert into member_metrics
  (member_id, metric_month, follower_count, sales_amount, deals_count, source_kind, source_ref, updated_at)
select member_id, date '2026-07-01', follower_count, sales_amount, coalesce(deals_count, 0), source_kind,
       coalesce(source_ref, '{}'::jsonb) || jsonb_build_object('migrated_on', '2026-07-25', 'migrated_note', '当月実績として付け替え'),
       updated_at
from current_value
on conflict (member_id, metric_month) do nothing;

-- 2) 7月より前の行を削除（6月以前を未登録にする）
delete from member_metrics where metric_month < date '2026-07-01';

commit;

-- 実行後の確認
select metric_month, count(*) as rows, sum(sales_amount) as total_sales
from member_metrics
group by metric_month
order by metric_month;
