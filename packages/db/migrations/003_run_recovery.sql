-- A hard deadline is deliberately independent of process liveness/heartbeats.
-- Legacy active captures get a full grace period when upgrading.
ALTER TABLE rc_runs ADD COLUMN attempt_deadline timestamptz;
UPDATE rc_runs SET attempt_deadline = clock_timestamp() + interval '2 minutes'
WHERE status = 'running';
CREATE INDEX rc_runs_active_deadline ON rc_runs(attempt_deadline)
WHERE status IN ('queued', 'running');
