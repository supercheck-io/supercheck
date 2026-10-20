ALTER TABLE status_page_components ADD COLUMN auto_incident_suppressed boolean NOT NULL DEFAULT false;
ALTER TABLE status_page_subscribers ADD COLUMN webhook_verification_token_hash varchar(64);
ALTER TABLE status_page_subscribers ADD COLUMN webhook_verification_expires_at timestamp;
ALTER TABLE status_page_notification_deliveries ADD COLUMN enqueued_at timestamp;
CREATE INDEX status_page_notification_deliveries_enqueue_idx ON status_page_notification_deliveries(enqueued_at) WHERE status = 'pending';
CREATE INDEX status_page_notification_deliveries_retention_idx ON status_page_notification_deliveries(updated_at) WHERE status IN ('delivered', 'failed', 'skipped');
-- Live webhook subscriptions predate ownership challenges; grandfather them so
-- an upgrade never silently stops incident notifications.
UPDATE status_page_subscribers
SET verified_at = COALESCE(created_at, now())
WHERE mode = 'webhook' AND verified_at IS NULL;
