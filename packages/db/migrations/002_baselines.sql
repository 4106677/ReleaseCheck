-- Old captures have no reproducible profile and cannot silently become baselines.
ALTER TABLE rc_captures ADD COLUMN profile_hash text;
ALTER TABLE rc_captures ADD CONSTRAINT rc_capture_profile CHECK (profile_hash IS NULL OR profile_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE rc_runs ADD COLUMN comparison jsonb;
ALTER TABLE rc_runs DROP CONSTRAINT rc_runs_verdict_check;
ALTER TABLE rc_runs ADD CONSTRAINT rc_runs_verdict_check CHECK (verdict IN ('pass', 'attention', 'inconclusive'));

-- Append-only approvals retain every historical version and artifact reference.
CREATE TABLE rc_baselines (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES rc_projects(id),
  profile_hash text NOT NULL CHECK (profile_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  source_run_id uuid NOT NULL REFERENCES rc_captures(run_id),
  artifact_id uuid NOT NULL REFERENCES rc_artifacts(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by text NOT NULL,
  UNIQUE (project_id, profile_hash, version)
);
