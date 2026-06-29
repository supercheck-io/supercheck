UPDATE "user"
SET "role" = CASE
  WHEN "role" IN ('super_admin', 'project_viewer') THEN "role"
  WHEN "role" IN ('owner', 'admin', 'member', 'user') THEN 'project_viewer'
  WHEN "role" IN ('org_owner', 'org_admin', 'project_admin', 'project_editor') THEN 'project_viewer'
  ELSE NULL
END
WHERE "role" IS NOT NULL
  AND "role" NOT IN ('super_admin', 'project_viewer');
--> statement-breakpoint
UPDATE "member"
SET "role" = CASE
  WHEN "role" = 'owner' THEN 'org_owner'
  WHEN "role" = 'admin' THEN 'org_admin'
  WHEN "role" = 'member' THEN 'project_viewer'
  WHEN "role" IN ('org_owner', 'org_admin', 'project_admin', 'project_editor', 'project_viewer') THEN "role"
  ELSE 'project_viewer'
END
WHERE "role" NOT IN ('org_owner', 'org_admin', 'project_admin', 'project_editor', 'project_viewer');
--> statement-breakpoint
UPDATE "project_members"
SET "role" = CASE
  WHEN "role" IN ('project_admin', 'project_editor', 'project_viewer') THEN "role"
  WHEN "role" IN ('owner', 'admin', 'org_owner', 'org_admin') THEN 'project_admin'
  WHEN "role" = 'member' THEN 'project_viewer'
  ELSE 'project_viewer'
END
WHERE "role" NOT IN ('project_admin', 'project_editor', 'project_viewer');
--> statement-breakpoint
ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS "user_role_canonical_check";
--> statement-breakpoint
ALTER TABLE "user"
  ADD CONSTRAINT "user_role_canonical_check"
  CHECK ("role" IS NULL OR "role" IN ('super_admin', 'project_viewer'));
--> statement-breakpoint
ALTER TABLE "member"
  DROP CONSTRAINT IF EXISTS "member_role_canonical_check";
--> statement-breakpoint
ALTER TABLE "member"
  ADD CONSTRAINT "member_role_canonical_check"
  CHECK ("role" IN ('org_owner', 'org_admin', 'project_admin', 'project_editor', 'project_viewer'));
--> statement-breakpoint
ALTER TABLE "project_members"
  DROP CONSTRAINT IF EXISTS "project_members_role_canonical_check";
--> statement-breakpoint
ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_role_canonical_check"
  CHECK ("role" IN ('project_admin', 'project_editor', 'project_viewer'));
