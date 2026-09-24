CREATE TABLE rc_projects (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
INSERT INTO rc_projects (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'ReleaseCheck demo');

CREATE TABLE rc_runs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES rc_projects(id),
  idempotency_key text NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  verdict text NOT NULL DEFAULT 'inconclusive' CHECK (verdict IN ('attention', 'inconclusive')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (project_id, idempotency_key),
  CHECK ((status IN ('completed', 'failed')) = (finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX rc_one_active_run ON rc_runs(project_id) WHERE status IN ('queued', 'running');
CREATE INDEX rc_runs_history ON rc_runs(project_id, created_at DESC, id DESC);

CREATE TABLE rc_artifacts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES rc_runs(id),
  storage_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK (bytes > 0),
  checksum text NOT NULL
);
CREATE TABLE rc_captures (
  run_id uuid PRIMARY KEY REFERENCES rc_runs(id),
  artifact_id uuid NOT NULL UNIQUE REFERENCES rc_artifacts(id),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  browser_version text NOT NULL,
  findings jsonb NOT NULL
);
