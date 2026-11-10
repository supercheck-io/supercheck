-- History for the PR screenshot tour (.github/workflows/pr-screenshots.yml).
--
-- The tour app runs without a worker, so nothing ever executes: no runs, no monitor
-- checks. This adds a week of run and check history for the records screenshots.setup.ts
-- created, so the dashboard, runs, monitor and job pages show data instead of empty states.
-- Values are fixed patterns (no random()), so frames stay comparable between runs.
--
-- Run only against the throwaway tour database, after screenshots.setup.ts.

\set ON_ERROR_STOP on

BEGIN;

-- Refuse to touch a database with any account the tour didn't create.
DO $$
BEGIN
  -- The CI database is the job's own service named supercheck, holding only the tour's
  -- accounts. (No server-address check: the service container sees a Docker bridge IP.)
  IF current_database() <> 'supercheck'
     OR NOT EXISTS (SELECT 1 FROM "user" WHERE email = 'reviewer@example.com')
     OR EXISTS (SELECT 1 FROM "user" WHERE email NOT LIKE '%@example.com') THEN
    RAISE EXCEPTION 'seed-history.sql only runs against the throwaway screenshot database';
  END IF;
END $$;

-- Monitor checks: every 30 minutes for a day, then every 6 hours back to 30 days.
-- "Marketing site" had a short outage 9 hours ago so the charts show a dip.
INSERT INTO monitor_results (id, monitor_id, checked_at, location, status, is_up, is_status_change, response_time_ms, details)
SELECT
  uuidv7(),
  m.id,
  t.at,
  'local',
  CASE WHEN m.name = 'Marketing site' AND t.at BETWEEN now() - interval '9 hours 40 minutes' AND now() - interval '9 hours' THEN 'down' ELSE 'up' END,
  NOT (m.name = 'Marketing site' AND t.at BETWEEN now() - interval '9 hours 40 minutes' AND now() - interval '9 hours'),
  m.name = 'Marketing site' AND t.at IN (now() - interval '9 hours 30 minutes', now() - interval '8 hours 30 minutes'),
  120 + (t.n * 37) % 90 + length(m.name),
  CASE WHEN m.name = 'Marketing site' AND t.at BETWEEN now() - interval '9 hours 40 minutes' AND now() - interval '9 hours'
    THEN '{"statusCode": 503, "statusText": "Service Unavailable", "errorMessage": "Expected 200, got 503"}'::jsonb
    ELSE '{"statusCode": 200, "statusText": "OK"}'::jsonb END
FROM monitors m
CROSS JOIN (
  SELECT n, now() - n * interval '30 minutes' AS at FROM generate_series(1, 48) AS n
  UNION ALL
  SELECT n, now() - n * interval '6 hours' AS at FROM generate_series(5, 120) AS n
) t;

UPDATE monitors
SET status = 'up', last_check_at = now() - interval '30 minutes', last_status_change_at = now() - interval '8 hours 30 minutes';

-- Job runs: one a day for a week, the third one failing.
INSERT INTO runs (id, job_id, project_id, status, trigger, started_at, completed_at, duration_ms, error_details, logs, created_at, updated_at)
SELECT
  uuidv7(),
  j.id,
  j.project_id,
  CASE WHEN d = 3 THEN 'failed' ELSE 'passed' END,
  CASE WHEN d % 2 = 0 THEN 'schedule' ELSE 'manual' END,
  now() - d * interval '1 day',
  now() - d * interval '1 day' + (40 + d * 3) * interval '1 second',
  (40 + d * 3) * 1000,
  CASE WHEN d = 3 THEN 'Error: expect(locator).toBeVisible() failed: getByRole(''button'', { name: ''Place order'' }) not found' END,
  CASE WHEN d = 3 THEN 'Running 1 test using 1 worker' || chr(10) || '1 failed' ELSE 'Running 1 test using 1 worker' || chr(10) || '1 passed' END,
  now() - d * interval '1 day',
  now() - d * interval '1 day'
FROM jobs j
CROSS JOIN generate_series(1, 7) AS d;

UPDATE jobs SET status = 'passed', last_run_at = now() - interval '1 day';

-- Role accounts (utils/screenshot.ts SCREENSHOT_IDENTITIES) join the demo organization the
-- way the real E2E deployment invites them. screenshots.setup.ts gives them no workspace of
-- their own, so the demo organization is the only one they belong to.
CREATE TEMP TABLE seed_roles (email text, role text) ON COMMIT DROP;
INSERT INTO seed_roles VALUES
  ('org-admin@example.com', 'org_admin'),
  ('project-admin@example.com', 'project_admin'),
  ('editor@example.com', 'project_editor'),
  ('viewer@example.com', 'project_viewer');

CREATE TEMP TABLE seed_org ON COMMIT DROP AS
SELECT m.organization_id AS id
FROM member m JOIN "user" u ON u.id = m.user_id
WHERE u.email = 'reviewer@example.com' AND m.role = 'org_owner'
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM seed_org) THEN
    RAISE EXCEPTION 'reviewer@example.com owns no organization; screenshots.setup.ts did not finish';
  END IF;
END $$;

INSERT INTO member (id, organization_id, user_id, role, created_at)
SELECT uuidv7(), o.id, u.id, r.role, now()
FROM seed_roles r JOIN "user" u ON u.email = r.email CROSS JOIN seed_org o;

INSERT INTO project_members (id, user_id, project_id, role, created_at)
SELECT uuidv7(), u.id, p.id, r.role, now()
FROM seed_roles r JOIN "user" u ON u.email = r.email
JOIN projects p ON p.organization_id = (SELECT id FROM seed_org)
WHERE r.role LIKE 'project_%';

UPDATE "user" SET role = 'super_admin' WHERE email = 'super-admin@example.com';

COMMIT;
