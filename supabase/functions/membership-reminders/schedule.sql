-- One-time setup to run the membership-reminders Edge Function on a daily
-- schedule via pg_cron. Run this in the Supabase SQL editor AFTER deploying
-- the function (see README.md in this folder).
--
-- Replace <PROJECT_REF> with your Supabase project ref (the subdomain in your
-- project URL, e.g. ujoiitdnmmvgnmplwlcz) and <ANON_KEY> with your project's
-- anon/publishable key (Project Settings -> API).

-- 1. Enable the required extensions (safe to re-run).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Schedule the daily job (06:00 UTC - adjust the cron expression if you'd
-- prefer a different time). If a job with this name already exists, unschedule
-- it first with: select cron.unschedule('membership-daily-check');
select cron.schedule(
  'membership-daily-check',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/membership-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'apikey', '<ANON_KEY>'
    ),
    body := jsonb_build_object()
  );
  $$
);

-- 3. Verify it's scheduled:
-- select * from cron.job;

-- 4. Check recent run history / troubleshoot failures:
-- select * from cron.job_run_details order by start_time desc limit 20;
