-- Reskill One production schema
-- Target: PostgreSQL 15+ / Supabase compatible

create extension if not exists pgcrypto;
create extension if not exists citext;

create type user_role as enum (
  'owner',
  'admin',
  'operator',
  'client_admin',
  'client_viewer'
);

create type user_status as enum (
  'invited',
  'active',
  'suspended'
);

create type company_role as enum (
  'operator',
  'client_admin',
  'client_viewer'
);

create type contract_status as enum (
  'active',
  'paused',
  'ended'
);

create type company_kind as enum (
  'client',
  'internal'
);

create type member_stage as enum (
  'new',
  'build',
  'pr'
);

create type evaluation_status as enum (
  'S',
  'A',
  'B',
  'F',
  'unrated'
);

create type source_kind as enum (
  'manual',
  'excel',
  'google_sheet',
  'system'
);

create type visibility as enum (
  'internal',
  'client'
);

create type session_type as enum (
  'mtg',
  'checkin',
  'status_report'
);

create type session_result as enum (
  'focus',
  'follow_required',
  'done',
  'continued'
);

create type report_status as enum (
  'draft',
  'published',
  'archived'
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table app_users (
  id uuid primary key default gen_random_uuid(),
  login_id citext not null unique,
  name text not null,
  email citext not null unique,
  global_role user_role not null default 'client_viewer',
  status user_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

create table companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  legal_name text,
  company_kind company_kind not null default 'client',
  contract_status contract_status not null default 'active',
  report_month date not null,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint companies_report_month_is_month_start check (date_trunc('month', report_month)::date = report_month)
);

create trigger companies_set_updated_at
before update on companies
for each row execute function set_updated_at();

create table company_users (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role company_role not null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id, role)
);

create index company_users_user_idx on company_users(user_id);

create table members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  stage member_stage not null default 'build',
  evaluation_status evaluation_status not null default 'unrated',
  progress_percent smallint not null default 0,
  client_memo text,
  internal_memo text,
  active boolean not null default true,
  source_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint members_progress_range check (progress_percent between 0 and 100)
);

create unique index members_company_normalized_name_active_idx
on members(company_id, normalized_name)
where deleted_at is null;

create index members_company_stage_idx on members(company_id, stage) where deleted_at is null;
create index members_company_evaluation_idx on members(company_id, evaluation_status) where deleted_at is null;

create trigger members_set_updated_at
before update on members
for each row execute function set_updated_at();

create table milestone_definitions (
  key text primary key,
  label text not null,
  group_key text not null,
  sort_order integer not null unique,
  active boolean not null default true
);

insert into milestone_definitions (key, label, group_key, sort_order) values
  ('daily', '毎日投稿', 'prerequisite', 10),
  ('qa', 'Q&A', 'prerequisite', 20),
  ('mtg', 'MTG', 'prerequisite', 30),
  ('orient', 'オリエン', 'build', 40),
  ('first_mtg', '初回MTG', 'build', 50),
  ('account', 'アカウント作成', 'build', 60),
  ('first_post', '初回投稿', 'build', 70),
  ('f100', 'フォロワー100', 'follower', 80),
  ('f300', 'フォロワー300', 'follower', 90),
  ('f500', 'フォロワー500', 'follower', 100),
  ('f700', 'フォロワー700', 'follower', 110),
  ('f1000', 'フォロワー1000', 'follower', 120),
  ('pr_mtg', 'PR初回MTG', 'pr', 130),
  ('product', '商品申請', 'pr', 140),
  ('pr_carousel', 'PRカルーセル', 'pr', 150),
  ('pr_video', 'PR動画', 'pr', 160),
  ('pr_tts', 'PR TTS', 'pr', 170),
  ('spark_ads', 'スパークアズ対象', 'pr', 180),
  ('sakura', 'サクラ連携', 'pr', 190),
  ('month1', '月1件獲得', 'result', 200),
  ('month10', '月10件獲得', 'result', 210),
  ('month30', '月30件獲得', 'result', 220),
  ('month100', '月100件獲得', 'result', 230)
on conflict (key) do nothing;

create table member_milestones (
  member_id uuid not null references members(id) on delete cascade,
  milestone_key text not null references milestone_definitions(key),
  done boolean not null default false,
  achieved_at timestamptz,
  updated_by uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (member_id, milestone_key),
  constraint member_milestones_achieved_when_done check (done or achieved_at is null)
);

create index member_milestones_key_done_idx on member_milestones(milestone_key, done);

create table member_accounts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  slot smallint not null,
  platform text not null default 'tiktok',
  handle text,
  url text,
  account_stage member_stage,
  active boolean not null default true,
  source_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_accounts_slot_range check (slot in (1, 2)),
  constraint member_accounts_has_identifier check (coalesce(nullif(url, ''), nullif(handle, '')) is not null)
);

create unique index member_accounts_member_slot_idx on member_accounts(member_id, slot);
create index member_accounts_url_idx on member_accounts(url) where url is not null;

create trigger member_accounts_set_updated_at
before update on member_accounts
for each row execute function set_updated_at();

create table member_metrics (
  member_id uuid not null references members(id) on delete cascade,
  metric_month date not null,
  follower_count integer not null default 0,
  sales_amount integer not null default 0,
  deals_count integer not null default 0,
  source_kind source_kind not null default 'manual',
  source_ref jsonb not null default '{}'::jsonb,
  updated_by uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (member_id, metric_month),
  constraint member_metrics_month_start check (date_trunc('month', metric_month)::date = metric_month),
  constraint member_metrics_non_negative check (follower_count >= 0 and sales_amount >= 0 and deals_count >= 0)
);

create index member_metrics_month_idx on member_metrics(metric_month);

create table coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  occurred_on date not null,
  session_type session_type not null default 'mtg',
  result session_result not null default 'continued',
  coach_name text,
  content text not null,
  next_action text,
  visibility visibility not null default 'client',
  source_kind source_kind not null default 'manual',
  source_ref jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index coaching_sessions_company_occurred_idx on coaching_sessions(company_id, occurred_on desc) where deleted_at is null;
create index coaching_sessions_member_occurred_idx on coaching_sessions(member_id, occurred_on desc) where deleted_at is null;

create trigger coaching_sessions_set_updated_at
before update on coaching_sessions
for each row execute function set_updated_at();

create table company_monthly_summaries (
  company_id uuid not null references companies(id) on delete cascade,
  summary_month date not null,
  enrollment_count integer not null default 0,
  new_count integer not null default 0,
  build_count integer not null default 0,
  pr_count integer not null default 0,
  avg_progress_percent numeric(5,2) not null default 0,
  total_sales_amount integer not null default 0,
  risk_member_count integer not null default 0,
  source_kind source_kind not null default 'system',
  source_ref jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  primary key (company_id, summary_month),
  constraint company_monthly_summaries_month_start check (date_trunc('month', summary_month)::date = summary_month),
  constraint company_monthly_summaries_non_negative check (
    enrollment_count >= 0 and new_count >= 0 and build_count >= 0 and pr_count >= 0
    and total_sales_amount >= 0 and risk_member_count >= 0
  )
);

create index company_monthly_summaries_month_idx on company_monthly_summaries(summary_month desc);

create table client_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  report_month date not null,
  executive_summary text,
  progress_good_text text not null default '',
  field_issue_text text not null default '',
  operator_action_text text not null default '',
  client_request_text text not null default '',
  focus_points jsonb not null default '[]'::jsonb,
  wins jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  requests_to_client jsonb not null default '[]'::jsonb,
  source_kind source_kind not null default 'manual',
  source_ref jsonb not null default '{}'::jsonb,
  status report_status not null default 'draft',
  published_at timestamptz,
  confirmed_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_reports_month_start check (date_trunc('month', report_month)::date = report_month)
);

create unique index client_reports_company_month_idx on client_reports(company_id, report_month);
create index client_reports_company_status_idx on client_reports(company_id, status, report_month desc);

create trigger client_reports_set_updated_at
before update on client_reports
for each row execute function set_updated_at();

create table update_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  actor_id uuid references app_users(id) on delete set null,
  summary text not null,
  status text not null default 'committed',
  created_at timestamptz not null default now(),
  constraint update_batches_status_check check (status in ('committed', 'reverted'))
);

create index update_batches_company_created_idx on update_batches(company_id, created_at desc);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references update_batches(id) on delete set null,
  actor_id uuid references app_users(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  target_type text not null,
  target_id uuid,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_company_created_idx on audit_logs(company_id, created_at desc);
create index audit_logs_target_idx on audit_logs(target_type, target_id, created_at desc);

create or replace view company_dashboard_latest as
with latest_summary as (
  select distinct on (company_id)
    company_id,
    summary_month,
    enrollment_count,
    new_count,
    build_count,
    pr_count,
    avg_progress_percent,
    total_sales_amount,
    risk_member_count
  from company_monthly_summaries
  order by company_id, summary_month desc
),
latest_report as (
  select distinct on (company_id)
    company_id,
    report_month,
    executive_summary,
    progress_good_text,
    field_issue_text,
    operator_action_text,
    client_request_text,
    status as report_status
  from client_reports
  where status in ('draft', 'published')
  order by company_id, report_month desc, updated_at desc
)
select
  c.id as company_id,
  c.code,
  c.name,
  s.summary_month,
  s.enrollment_count,
  s.new_count,
  s.build_count,
  s.pr_count,
  s.avg_progress_percent,
  s.total_sales_amount,
  s.risk_member_count,
  r.report_month,
  r.executive_summary,
  r.progress_good_text,
  r.field_issue_text,
  r.operator_action_text,
  r.client_request_text,
  r.report_status
from companies c
left join latest_summary s on s.company_id = c.id
left join latest_report r on r.company_id = c.id
where c.deleted_at is null
order by c.name;

create or replace view member_current_metrics as
select distinct on (m.id)
  m.id as member_id,
  mm.metric_month,
  mm.follower_count,
  mm.sales_amount,
  mm.deals_count
from members m
left join member_metrics mm on mm.member_id = m.id
where m.deleted_at is null
order by m.id, mm.metric_month desc;
