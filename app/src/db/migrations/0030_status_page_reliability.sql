ALTER TABLE status_page_components ADD COLUMN auto_create_incidents boolean NOT NULL DEFAULT false;
ALTER TABLE status_page_components ADD COLUMN service_id uuid REFERENCES sre_services(id) ON DELETE SET NULL;
ALTER TABLE incidents ADD COLUMN source_component_id uuid REFERENCES status_page_components(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX incidents_open_automatic_component_idx ON incidents(source_component_id) WHERE source_component_id IS NOT NULL AND status <> 'resolved';
CREATE INDEX incidents_sre_page_idx ON incidents(status_page_id, sre_incident_id) WHERE sre_incident_id IS NOT NULL;
CREATE TABLE status_page_notification_events (
 id uuid PRIMARY KEY DEFAULT uuidv7(), incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
 update_id uuid NOT NULL REFERENCES incident_updates(id) ON DELETE CASCADE,
 is_creation boolean NOT NULL DEFAULT false, expanded_at timestamp, created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX status_page_notification_event_update_idx ON status_page_notification_events(update_id);
CREATE INDEX status_page_notification_events_pending_idx ON status_page_notification_events(created_at) WHERE expanded_at IS NULL;
CREATE TABLE status_page_notification_deliveries (
 id uuid PRIMARY KEY DEFAULT uuidv7(), event_id uuid NOT NULL REFERENCES status_page_notification_events(id) ON DELETE CASCADE,
 subscriber_id uuid NOT NULL REFERENCES status_page_subscribers(id) ON DELETE CASCADE,
 mode varchar(50) NOT NULL, status varchar(20) NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 leased_until timestamp, last_error text, updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX status_page_notification_delivery_recipient_idx ON status_page_notification_deliveries(event_id, subscriber_id);
CREATE INDEX status_page_notification_deliveries_pending_idx ON status_page_notification_deliveries(updated_at) WHERE status = 'pending';
CREATE INDEX status_page_components_service_idx ON status_page_components(service_id);
CREATE INDEX incidents_source_component_idx ON incidents(source_component_id);
CREATE INDEX status_page_notification_events_incident_idx ON status_page_notification_events(incident_id);
CREATE INDEX status_page_notification_deliveries_subscriber_idx ON status_page_notification_deliveries(subscriber_id);
ALTER TABLE status_pages ADD COLUMN custom_domain_last_checked_at timestamp;
ALTER TABLE status_page_components ADD COLUMN last_reconciled_at timestamp;
CREATE INDEX status_page_components_reconciliation_idx ON status_page_components(last_reconciled_at, id);
CREATE INDEX incident_components_component_idx ON incident_components(component_id);
