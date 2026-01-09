CREATE TABLE "requirement_tags" (
	"requirement_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	CONSTRAINT "requirement_tags_requirement_id_tag_id_pk" PRIMARY KEY("requirement_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "monitor_results" ADD COLUMN "execution_group_id" text;--> statement-breakpoint
ALTER TABLE "requirement_tags" ADD CONSTRAINT "requirement_tags_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_tags" ADD CONSTRAINT "requirement_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_results_execution_group_idx" ON "monitor_results" USING btree ("monitor_id","execution_group_id");