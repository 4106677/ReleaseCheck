CREATE TABLE rc_oauth_states (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rc_oauth_states_expiry_idx ON rc_oauth_states(expires_at);
