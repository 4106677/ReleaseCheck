CREATE TABLE rc_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL
);
INSERT INTO rc_users (id, display_name) VALUES ('00000000-0000-4000-8000-000000000002', 'Local developer');
ALTER TABLE rc_projects ADD COLUMN owner_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000002' REFERENCES rc_users(id);
ALTER TABLE rc_projects ALTER COLUMN owner_id DROP DEFAULT;
CREATE TABLE rc_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES rc_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rc_sessions_expiry_idx ON rc_sessions(expires_at);
