import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEMO_PROJECT_ID, projectSchema, type Project } from '@releasecheck/contracts';
import { request } from './api.js';

const projectPath = `/projects/${DEMO_PROJECT_ID}`;
const queryKey = ['project', DEMO_PROJECT_ID];

function SettingsForm({ initial }: { initial: Project }) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(String(initial.maxDiffBasisPoints / 100));
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const basisPoints = Number(value) * 100;
  const valid =
    value.trim() !== '' &&
    Number.isFinite(basisPoints) &&
    Math.abs(basisPoints - Math.round(basisPoints)) < 1e-8 &&
    basisPoints >= 0 &&
    basisPoints <= 500;
  const adopt = (project: Project) => {
    setSaved(project);
    setValue(String(project.maxDiffBasisPoints / 100));
    client.setQueryData(queryKey, project);
  };
  const save = useMutation({
    mutationFn: async () =>
      projectSchema.parse(
        await request(projectPath, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: saved.settingsVersion,
            maxDiffBasisPoints: Math.round(basisPoints),
          }),
        }),
      ),
    onSuccess: adopt,
  });
  const busy = save.isPending || reloading;
  return (
    <form
      className="rc-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) save.mutate();
      }}
    >
      <h2>Visual comparison</h2>
      <label htmlFor="tolerance">Allowed visual difference (%)</label>
      <p id="tolerance-help">
        A check passes its visual comparison when the changed pixel percentage stays within this
        limit. Browser errors still need attention.
      </p>
      <input
        id="tolerance"
        type="number"
        min="0"
        max="5"
        step="0.01"
        required
        value={value}
        disabled={busy}
        aria-describedby="tolerance-help"
        onChange={(event) => {
          setValue(event.target.value);
          save.reset();
        }}
      />
      <p>
        Choose 0–5%. Default: 0.1%. Applies to future checks; queued checks, saved reports and
        baselines stay unchanged.
      </p>
      <div className="rc-dialog-actions">
        <button className="dp-summary-button" disabled={busy || !valid}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setReloading(true);
            setReloadError('');
            try {
              adopt(projectSchema.parse(await request(projectPath)));
              save.reset();
            } catch (error) {
              setReloadError(error instanceof Error ? error.message : 'Could not reload settings.');
            } finally {
              setReloading(false);
            }
          }}
        >
          {reloading ? 'Reloading…' : 'Reload settings'}
        </button>
      </div>
      {save.isSuccess && <p role="status">Settings saved for future checks.</p>}
      {save.error && (
        <p role="alert">
          {save.error.message} Your input has been kept. Reload settings to use the latest saved
          values.
        </p>
      )}
      {reloadError && <p role="alert">{reloadError}</p>}
    </form>
  );
}

export function ProjectSettings() {
  const project = useQuery({
    queryKey,
    queryFn: async () => projectSchema.parse(await request(projectPath)),
  });
  if (project.error) return <p role="alert">{project.error.message}</p>;
  if (!project.data) return <p role="status">Loading project…</p>;
  return (
    <section className="rc-report" aria-label="Project settings">
      <div className="dp-report-head">
        <div>
          <div className="dp-eyebrow">DEMO PROJECT</div>
          <h1>Project settings</h1>
          <p>{project.data.name}</p>
        </div>
      </div>
      <div className="rc-notice">
        Controlled storefront · Homepage / · Chromium · Desktop 1440 × 900 / Mobile width 390 × 844
      </div>
      <SettingsForm initial={project.data} />
    </section>
  );
}
