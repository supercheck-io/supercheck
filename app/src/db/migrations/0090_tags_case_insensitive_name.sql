-- Tag names become unique per project case-insensitively. Existing case-twins ("Smoke" next to "smoke") keep
-- the oldest row's name (a legacy NULL created_at counts as oldest); each later twin is renamed to the first
-- free "<name>-N" (within 50 characters), so no row is deleted and every monitor/test/requirement link stays on
-- its tag. The 50-character cap (the column allows 100) keeps renamed legacy names short enough to show in the UI.
-- The lock comes first and is held to commit: it blocks tag writes (older pods do not take the app's tag lock),
-- so no new case-twin can appear between the renames and the index build. Reads still proceed.
LOCK TABLE "tags" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
DECLARE
  twin record;
  n integer;
  candidate text;
BEGIN
  FOR twin IN
    SELECT id, project_id, name
    FROM (
      SELECT id, project_id, name, created_at,
        row_number() OVER (PARTITION BY project_id, lower(name) ORDER BY created_at NULLS FIRST, id) AS rank
      FROM tags
    ) ranked
    WHERE rank > 1
    ORDER BY project_id, lower(name), created_at NULLS FIRST, id
  LOOP
    n := 2;
    LOOP
      candidate := left(twin.name, 50 - length('-' || n)) || '-' || n;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM tags WHERE project_id = twin.project_id AND lower(name) = lower(candidate)
      );
      n := n + 1;
    END LOOP;
    UPDATE tags SET name = candidate, updated_at = now() WHERE id = twin.id;
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_project_lower_name_idx" ON "tags" USING btree ("project_id",lower("name"));
