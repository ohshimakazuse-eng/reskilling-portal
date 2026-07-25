-- 移行前に実行する診断SQL（読み取り専用・データは一切変更しない）
-- 何が残っていて何が復元できるかを、実データで確認するためのもの。

-- 1) 現在の実績が「どの月」に何行あり、いつ最後に更新されたか
--    updated_at が 2026-07 以降なら、その数字は7月に上書きされた最新値。
--    updated_at が 2026-06 以前なら、その数字は6月時点で確定した値。
select
  metric_month,
  count(*)                                                    as rows,
  count(*) filter (where updated_at >= timestamptz '2026-07-01 00:00:00+09') as 更新が7月以降,
  count(*) filter (where updated_at <  timestamptz '2026-07-01 00:00:00+09') as 更新が6月以前,
  min(updated_at) as 最古の更新,
  max(updated_at) as 最新の更新
from member_metrics
group by metric_month
order by metric_month;

-- 2) 6月中に保存された履歴として監査ログに残っているもの
--    ここに残るのは「会社合計の売上」と保存時刻のみで、受講生ごとの内訳・フォロワーは含まれない。
select
  c.name                              as 会社,
  a.created_at                        as 保存時刻,
  (a.after_json->>'sales')::bigint    as 会社合計売上,
  (a.after_json->>'members')::int     as 在籍数,
  a.after_json->>'summary'            as 操作内容
from audit_logs a
join companies c on c.id = a.company_id
where a.target_type = 'company'
  and a.created_at >= timestamptz '2026-06-01 00:00:00+09'
  and a.created_at <  timestamptz '2026-07-01 00:00:00+09'
order by c.name, a.created_at desc;

-- 3) 監査ログの after_json にどんなキーが入っているか
--    受講生ごとのフォロワー/売上のキーが存在しないことの確認用。
select k as キー, count(*) as 件数
from audit_logs a, lateral jsonb_object_keys(a.after_json) k
where a.after_json is not null
group by k
order by 件数 desc;

-- 4) すでに複数月の実績を持つ受講生がいるか（いれば履歴が一部残っている）
select m.display_name, count(*) as 月数, min(mm.metric_month) as 最古, max(mm.metric_month) as 最新
from member_metrics mm
join members m on m.id = mm.member_id
group by m.display_name
having count(*) > 1
order by 月数 desc;
