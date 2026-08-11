create table if not exists public.fb_ads_fact (
  id bigint generated always as identity primary key,
  date date not null,
  granularity text not null check (granularity in ('realtime', 'daily')),
  campaign_id text not null,
  campaign_name text not null,
  adset_id text not null,
  adset_name text not null,
  ad_id text not null,
  ad_name text not null,
  objective text,
  optimization_goal text,
  result_group text not null check (result_group in ('Inbox', 'Engage', 'Lead', 'Click', 'View', 'Reach', 'Sales', 'Recall')),
  result_action_type text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  frequency numeric,
  clicks_link bigint not null default 0,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  result_value numeric not null default 0,
  cost_per_result numeric,
  effective_status text,
  updated_at timestamptz not null default now(),
  unique (date, granularity, ad_id)
);

create index if not exists fb_ads_fact_date_granularity_idx
  on public.fb_ads_fact (date desc, granularity);

create index if not exists fb_ads_fact_campaign_idx
  on public.fb_ads_fact (campaign_id, date desc);

create index if not exists fb_ads_fact_result_group_idx
  on public.fb_ads_fact (result_group, date desc);

create or replace view public.fb_ads_weekly
with (security_invoker = true)
as
select
  date_trunc('week', date)::date as week_start,
  campaign_id,
  campaign_name,
  adset_id,
  adset_name,
  ad_id,
  ad_name,
  objective,
  optimization_goal,
  result_group,
  result_action_type,
  sum(spend) as spend,
  sum(impressions) as impressions,
  sum(reach) as reach,
  sum(clicks_link) as clicks_link,
  sum(result_value) as result_value,
  sum(spend) / nullif(sum(result_value), 0) as cost_per_result,
  max(effective_status) as effective_status,
  max(updated_at) as updated_at
from public.fb_ads_fact
where granularity = 'daily'
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

create or replace view public.fb_ads_monthly
with (security_invoker = true)
as
select
  date_trunc('month', date)::date as month_start,
  campaign_id,
  campaign_name,
  adset_id,
  adset_name,
  ad_id,
  ad_name,
  objective,
  optimization_goal,
  result_group,
  result_action_type,
  sum(spend) as spend,
  sum(impressions) as impressions,
  sum(reach) as reach,
  sum(clicks_link) as clicks_link,
  sum(result_value) as result_value,
  sum(spend) / nullif(sum(result_value), 0) as cost_per_result,
  max(effective_status) as effective_status,
  max(updated_at) as updated_at
from public.fb_ads_fact
where granularity = 'daily'
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

alter table public.fb_ads_fact enable row level security;

drop policy if exists "dashboard read only for anon" on public.fb_ads_fact;
create policy "dashboard read only for anon"
  on public.fb_ads_fact for select
  to anon
  using (true);

drop policy if exists "dashboard read only for authenticated" on public.fb_ads_fact;
create policy "dashboard read only for authenticated"
  on public.fb_ads_fact for select
  to authenticated
  using (true);

grant select on public.fb_ads_fact, public.fb_ads_weekly, public.fb_ads_monthly to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fb_ads_fact'
  ) then
    alter publication supabase_realtime add table public.fb_ads_fact;
  end if;
end $$;

