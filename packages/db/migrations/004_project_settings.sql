ALTER TABLE rc_projects
  ADD COLUMN settings_version integer NOT NULL DEFAULT 1 CHECK (settings_version > 0),
  ADD COLUMN max_diff_basis_points integer NOT NULL DEFAULT 10
    CHECK (max_diff_basis_points BETWEEN 0 AND 500);
