CREATE TABLE IF NOT EXISTS device_authorizations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  device_code_hash varchar(64) NOT NULL,
  user_code_hash varchar(64) NOT NULL,
  client_id varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  expires_at timestamp NOT NULL,
  poll_interval_seconds integer NOT NULL DEFAULT 5,
  last_polled_at timestamp,
  verification_attempts integer NOT NULL DEFAULT 0,
  approved_user_id uuid REFERENCES "user"(id) ON DELETE CASCADE,
  approved_project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  approved_at timestamp,
  api_key_id uuid REFERENCES apikey(id) ON DELETE SET NULL,
  consumed_at timestamp,
  client_metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT device_authorizations_status_check
    CHECK (status IN ('pending', 'approved', 'denied', 'consumed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS device_authorizations_device_code_hash_idx ON device_authorizations(device_code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS device_authorizations_user_code_hash_idx ON device_authorizations(user_code_hash);
CREATE INDEX IF NOT EXISTS device_authorizations_expires_at_idx ON device_authorizations(expires_at);
