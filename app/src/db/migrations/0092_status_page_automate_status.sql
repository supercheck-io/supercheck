-- Monitor-driven component status is opt-in: every component starts manual, existing ones included.
ALTER TABLE "status_page_components" ADD COLUMN "automate_status" boolean DEFAULT false NOT NULL;
