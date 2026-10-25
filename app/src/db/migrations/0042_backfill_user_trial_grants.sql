-- Preserve grants for existing trial owners, including expired trials.
UPDATE "user" AS u
SET "trial_granted_at" = grants.started_at
FROM (
  SELECT m."user_id", min(coalesce(e."trial_started_at", e."expires_at" - interval '14 days')) AS started_at
  FROM "member" AS m
  JOIN "execution_entitlements" AS e ON e."organization_id" = m."organization_id"
  WHERE m."role" = 'org_owner'
  GROUP BY m."user_id"
) AS grants
WHERE u."id" = grants."user_id" AND u."trial_granted_at" IS NULL;
