-- Tag names become unique per project case-insensitively. Existing case-twins ("Smoke" next to "smoke") keep
-- the oldest row's name; each later twin is renamed to the first free "<name>-N" (within 50 characters), so
-- no row is deleted and every monitor/test/requirement link stays on its tag. The 50-character cap (the column
-- allows 100) keeps renamed legacy names short enough to show in the UI.
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
        row_number() OVER (PARTITION BY project_id, lower(name) ORDER BY created_at, id) AS rank
      FROM tags
    ) ranked
    WHERE rank > 1
    ORDER BY project_id, lower(name), created_at, id
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
DROP INDEX "tags_project_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "tags_project_name_idx" ON "tags" USING btree ("project_id",lower("name"));
