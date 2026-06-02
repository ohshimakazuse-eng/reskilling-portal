-- Supabase Row Level Security policies for Reskill One
-- Apply after production-db-schema.sql when Supabase Auth is used.

create or replace function current_app_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid()
$$;

create or replace function is_global_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app_users u
    where u.id = current_app_user_id()
      and u.deleted_at is null
      and u.status = 'active'
      and u.global_role in ('owner', 'admin')
  )
$$;

create or replace function has_company_access(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select is_global_admin()
    or exists (
      select 1
      from company_users cu
      join app_users u on u.id = cu.user_id
      where cu.company_id = target_company_id
        and cu.user_id = current_app_user_id()
        and u.deleted_at is null
        and u.status = 'active'
    )
$$;

create or replace function can_update_company(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select is_global_admin()
    or exists (
      select 1
      from company_users cu
      join app_users u on u.id = cu.user_id
      where cu.company_id = target_company_id
        and cu.user_id = current_app_user_id()
        and cu.role = 'operator'
        and u.deleted_at is null
        and u.status = 'active'
    )
$$;

create or replace function can_access_member(target_member_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from members m
    where m.id = target_member_id
      and has_company_access(m.company_id)
  )
$$;

alter table app_users enable row level security;
alter table companies enable row level security;
alter table company_users enable row level security;
alter table members enable row level security;
alter table member_milestones enable row level security;
alter table member_accounts enable row level security;
alter table member_metrics enable row level security;
alter table coaching_sessions enable row level security;
alter table company_monthly_summaries enable row level security;
alter table client_reports enable row level security;
alter table update_batches enable row level security;
alter table audit_logs enable row level security;

create policy app_users_select_self_or_admin
on app_users for select
using (id = current_app_user_id() or is_global_admin());

create policy app_users_update_self_or_admin
on app_users for update
using (id = current_app_user_id() or is_global_admin())
with check (id = current_app_user_id() or is_global_admin());

create policy companies_select_by_access
on companies for select
using (has_company_access(id));

create policy companies_write_admin_only
on companies for all
using (is_global_admin())
with check (is_global_admin());

create policy company_users_select_by_access
on company_users for select
using (has_company_access(company_id));

create policy company_users_write_admin_only
on company_users for all
using (is_global_admin())
with check (is_global_admin());

create policy members_select_by_company
on members for select
using (has_company_access(company_id));

create policy members_write_by_operator
on members for all
using (can_update_company(company_id))
with check (can_update_company(company_id));

create policy member_milestones_select_by_member
on member_milestones for select
using (can_access_member(member_id));

create policy member_milestones_write_by_operator
on member_milestones for all
using (
  exists (
    select 1 from members m
    where m.id = member_id and can_update_company(m.company_id)
  )
)
with check (
  exists (
    select 1 from members m
    where m.id = member_id and can_update_company(m.company_id)
  )
);

create policy member_accounts_select_by_member
on member_accounts for select
using (can_access_member(member_id));

create policy member_accounts_write_by_operator
on member_accounts for all
using (
  exists (
    select 1 from members m
    where m.id = member_id and can_update_company(m.company_id)
  )
)
with check (
  exists (
    select 1 from members m
    where m.id = member_id and can_update_company(m.company_id)
  )
);

create policy member_metrics_select_by_member
on member_metrics for select
using (can_access_member(member_id));

create policy member_metrics_write_by_operator
on member_metrics for all
using (
  exists (
    select 1 from members m
    where m.id = member_id and can_update_company(m.company_id)
  )
)
with check (
  exists (
    select 1 from members m
    where m.id = member_id and can_update_company(m.company_id)
  )
);

create policy coaching_sessions_select_by_company
on coaching_sessions for select
using (has_company_access(company_id));

create policy coaching_sessions_write_by_operator
on coaching_sessions for all
using (can_update_company(company_id))
with check (can_update_company(company_id));

create policy company_monthly_summaries_select_by_company
on company_monthly_summaries for select
using (has_company_access(company_id));

create policy company_monthly_summaries_write_by_operator
on company_monthly_summaries for all
using (can_update_company(company_id))
with check (can_update_company(company_id));

create policy client_reports_select_by_company
on client_reports for select
using (has_company_access(company_id));

create policy client_reports_write_by_operator
on client_reports for all
using (can_update_company(company_id))
with check (can_update_company(company_id));

create policy update_batches_select_by_company
on update_batches for select
using (company_id is null or has_company_access(company_id));

create policy update_batches_insert_by_operator
on update_batches for insert
with check (company_id is null or can_update_company(company_id));

create policy audit_logs_select_by_company
on audit_logs for select
using (company_id is null or has_company_access(company_id));

create policy audit_logs_insert_by_operator
on audit_logs for insert
with check (company_id is null or can_update_company(company_id));
