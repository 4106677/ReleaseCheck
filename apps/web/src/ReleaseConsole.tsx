import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  baselineStateSchema,
  createdRunSchema,
  DEMO_PROJECT_ID,
  isTerminal,
  runHistorySchema,
  runSchema,
  type CreateRun,
  type Run,
} from '@releasecheck/contracts';
import { request } from './api.js';
import { ScreenshotViewer, type View } from './design/ScreenshotViewer.js';
import './design/design.css';
import './console.css';

const artifactUrl = (id: string) => `/api/artifacts/${id}`;
const percent = (ratio: number) => (ratio * 100).toFixed(2);
const verdictLabel = {
  pass: 'Checks passed',
  attention: 'Needs attention',
  inconclusive: 'Incomplete evidence',
};

function BaselineApproval({ run }: { run: Run }) {
  const client = useQueryClient();
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const current = useQuery({
    queryKey: ['baseline', run.id],
    queryFn: async () => baselineStateSchema.parse(await request(`/runs/${run.id}/baseline`)),
  });
  const approval = useMutation({
    mutationFn: async (version: number) =>
      baselineStateSchema.parse(
        await request(`/projects/${DEMO_PROJECT_ID}/baselines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: run.id, expectedVersion: version }),
        }),
      ),
    onSuccess: async () => {
      setExpectedVersion(null);
      await client.invalidateQueries({ queryKey: ['baseline'] });
    },
    onError: () => {
      void current.refetch();
    },
  });
  const alreadyApproved = current.data?.baseline?.sourceRunId === run.id;
  return (
    <div className="rc-approval">
      <div>
        <strong>Visual baseline</strong>
        <p>
          {current.data?.baseline
            ? `Current version: v${current.data.baseline.version} · approved ${new Date(current.data.baseline.approvedAt).toLocaleString()}`
            : current.isPending
              ? 'Loading baseline…'
              : 'No approved baseline for this capture profile.'}
        </p>
        <p>Approval affects future checks. This report and browser issues stay unchanged.</p>
        {!run.capture?.profileHash && (
          <p>Capture profile unavailable. Run a new check before approving.</p>
        )}
        {current.error && <p role="alert">{current.error.message}</p>}
        {approval.isSuccess && <p role="status">Baseline saved for future checks.</p>}
      </div>
      <button
        className="dp-summary-button"
        disabled={
          !run.capture?.profileHash ||
          !current.data ||
          current.isFetching ||
          alreadyApproved ||
          approval.isPending
        }
        onClick={() => {
          approval.reset();
          setExpectedVersion(current.data?.baseline?.version ?? 0);
        }}
      >
        {alreadyApproved ? 'Current baseline' : 'Use as baseline'}
      </button>
      {expectedVersion !== null && (
        <div className="dp-dialog-backdrop">
          <dialog
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            aria-labelledby="baseline-title"
            onCancel={(event) => {
              if (approval.isPending) event.preventDefault();
              else setExpectedVersion(null);
            }}
          >
            <div className="dp-eyebrow">BASELINE DECISION</div>
            <h2 id="baseline-title">Use this capture as the baseline?</h2>
            <p>
              This will{' '}
              {expectedVersion === 0
                ? 'create version 1'
                : `replace v${expectedVersion} with v${expectedVersion + 1}`}{' '}
              for future checks in the same browser environment.
            </p>
            <p>
              Source check: <code>{run.id.slice(0, 8)}</code>
            </p>
            {!!run.capture?.findings.length && (
              <p className="rc-warning">
                This capture contains {run.capture.findings.length} browser observations. Accepting
                its appearance does not resolve them.
              </p>
            )}
            {approval.error && (
              <p role="alert" className="rc-warning">
                {approval.error.message} Close this dialog and review the current baseline before
                retrying.
              </p>
            )}
            <div className="rc-dialog-actions">
              <button
                autoFocus
                disabled={approval.isPending}
                onClick={() => setExpectedVersion(null)}
              >
                Cancel
              </button>
              <button
                className="dp-summary-button"
                disabled={approval.isPending || !!approval.error}
                onClick={() => approval.mutate(expectedVersion)}
              >
                {approval.isPending ? 'Saving…' : 'Confirm baseline'}
              </button>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
}

function Report({ id }: { id: string }) {
  const [view, setView] = useState<View>('split');
  const [position, setPosition] = useState(58);
  const [issueIndex, setIssueIndex] = useState(0);
  const { data: run, error } = useQuery({
    queryKey: ['run', id],
    queryFn: async () => runSchema.parse(await request(`/runs/${id}`)),
    refetchInterval: (query) =>
      query.state.data && isTerminal(query.state.data.status) ? false : 2000,
    refetchIntervalInBackground: false,
  });
  if (error)
    return (
      <p role="alert" className="rc-warning">
        {error.message}
      </p>
    );
  if (!run) return <p role="status">Loading check…</p>;
  const comparison = run.comparison;
  const compared =
    comparison?.status === 'matched' || comparison?.status === 'changed' ? comparison : null;
  const findings = run.capture?.findings ?? [];
  const issues = [
    ...(compared?.status === 'changed'
      ? [
          {
            kind: 'visual',
            message: `${percent(compared.diffRatio)}% of pixels changed`,
            detail: `${compared.changedPixels.toLocaleString()} changed pixels exceed the allowed ${percent(compared.maxDiffRatio)}%. Review the difference image before accepting this appearance.`,
          },
        ]
      : []),
    ...findings.map((finding) => ({
      ...finding,
      detail: finding.url ?? 'Observed while capturing the page.',
    })),
  ];
  const issue = issues[issueIndex] ?? issues[0];
  const visualNotice = compared
    ? `Compared with baseline v${compared.baseline.version} from check ${compared.baseline.sourceRunId.slice(0, 8)}.`
    : comparison?.status === 'incompatible'
      ? `Visual comparison unavailable: capture ${comparison.reason === 'profile' ? 'environment differs from the saved baseline' : 'dimensions differ'}. Review and approve a compatible capture.`
      : run.capture?.profileHash
        ? 'No baseline was available when this check was queued. Review the capture and approve your first baseline.'
        : 'This older capture has no saved comparison profile. Run a new check to create a baseline.';
  return (
    <section className="rc-report" aria-label="Check result" data-run-id={run.id}>
      <div className="dp-report-head">
        <div>
          <div className="dp-eyebrow">CHECK {run.id.slice(0, 8)}</div>
          <h1>
            Release review<span className="dp-heading-dot">●</span>
          </h1>
          <p>
            {run.variant === 'baseline' ? 'Original' : 'Changed'} storefront ·{' '}
            {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`rc-status ${run.status}`}>{run.status}</span>
      </div>
      <div className="dp-overview">
        <div className={`dp-result rc-verdict-${run.verdict}`}>
          <span className="dp-result-icon">{run.verdict === 'pass' ? '✓' : '!'}</span>
          <div>
            <strong>
              {isTerminal(run.status) ? verdictLabel[run.verdict] : 'Check in progress'}
            </strong>
            <span>Attempt {run.attempt} · Chromium</span>
          </div>
        </div>
        <div className="dp-stat">
          <small>VISUAL CHANGE</small>
          <strong>
            {compared ? percent(compared.diffRatio) : '—'}
            <span>{compared ? '%' : 'not compared'}</span>
          </strong>
        </div>
        <div className="dp-stat">
          <small>BROWSER OBSERVATIONS</small>
          <strong>{run.capture ? findings.length : '—'}</strong>
        </div>
        <div className="dp-stat dp-profile">
          <small>CAPTURE PROFILE</small>
          <strong>
            Desktop<span>1440 × 900</span>
          </strong>
        </div>
      </div>
      {!isTerminal(run.status) && (
        <p role="status" className="rc-notice">
          {run.status === 'queued'
            ? 'Waiting for the worker…'
            : 'Capturing the page and comparing its appearance…'}
        </p>
      )}
      {run.error && (
        <p role="alert" className="rc-warning">
          The check could not finish: {run.error}. Run a new check to retry.
        </p>
      )}
      {run.capture && (
        <>
          <p className="rc-notice">{visualNotice}</p>
          <div className="dp-review-grid">
            <section className="dp-evidence" aria-label="Visual comparison">
              <div className="dp-evidence-head">
                <div>
                  <span className="dp-page-icon">▧</span>
                  <strong>Homepage</strong>
                  <code>/</code>
                </div>
                <span className="dp-change-pill">
                  {compared?.status === 'changed'
                    ? 'Visual change'
                    : compared
                      ? 'Within tolerance'
                      : 'Capture only'}
                </span>
              </div>
              <div className="dp-view-controls">
                <div className="dp-tabs" aria-label="Screenshot view">
                  {(
                    [
                      ['split', 'Compare'],
                      ['before', 'Baseline'],
                      ['after', 'Current'],
                      ['diff', 'Difference'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      disabled={!compared && mode !== 'after'}
                      aria-pressed={(compared ? view : 'after') === mode}
                      onClick={() => setView(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <ScreenshotViewer
                view={compared ? view : 'after'}
                position={position}
                onPosition={setPosition}
                after={artifactUrl(run.capture.artifactId)}
                before={compared ? artifactUrl(compared.baseline.artifactId) : undefined}
                diff={compared ? artifactUrl(compared.diffArtifactId) : undefined}
              />
              <div className="dp-evidence-footer">
                <span>
                  {compared
                    ? `${compared.changedPixels.toLocaleString()} changed pixels · tolerance ${percent(compared.maxDiffRatio)}%`
                    : 'No visual verdict available'}
                </span>
                <a href={artifactUrl(run.capture.artifactId)} target="_blank" rel="noreferrer">
                  Open capture ↗
                </a>
              </div>
            </section>
            <aside className="dp-issues" aria-label="Issues to review">
              <div className="dp-issues-header">
                <h2>Review queue</h2>
                <span>{issues.length}</span>
              </div>
              <p className="dp-issues-description">
                {issues.length
                  ? 'Inspect the evidence before accepting a change.'
                  : 'No JavaScript or network errors observed during this capture.'}
              </p>
              <div className="dp-issue-list">
                {issues.map((item, index) => (
                  <button
                    className="dp-issue"
                    key={index}
                    aria-pressed={issue === item}
                    onClick={() => {
                      setIssueIndex(index);
                      if (item.kind === 'visual') setView('diff');
                    }}
                  >
                    <span className="dp-issue-number">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <small>{item.kind}</small>
                      <strong>{item.message}</strong>
                    </div>
                    <span className="dp-issue-arrow">↗</span>
                  </button>
                ))}
              </div>
              {issue && (
                <div className="dp-issue-detail" aria-live="polite">
                  <h3>{issue.message}</h3>
                  <p>{issue.detail}</p>
                </div>
              )}
              <div className="dp-review-note">
                <span>↳</span>
                <p>
                  {compared?.status === 'matched' && !findings.length
                    ? 'Visual and browser checks passed for this page and viewport.'
                    : 'Accepting a visual baseline does not resolve browser errors.'}
                </p>
              </div>
            </aside>
          </div>
          <BaselineApproval run={run} />
        </>
      )}
    </section>
  );
}

export default function ReleaseConsole() {
  const client = useQueryClient();
  const [variant, setVariant] = useState<CreateRun['variant']>('baseline');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['history'],
    queryFn: async () => runHistorySchema.parse(await request(`/projects/${DEMO_PROJECT_ID}/runs`)),
    refetchInterval: (query) =>
      query.state.data?.some((run) => !isTerminal(run.status)) ? 2000 : false,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: async () =>
      createdRunSchema.parse(
        await request(`/projects/${DEMO_PROJECT_ID}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({ variant }),
        }),
      ).id,
    onSuccess: (id) => {
      setSelected(id);
      setKey(crypto.randomUUID());
      void client.invalidateQueries({ queryKey: ['history'] });
    },
  });
  const active = history.data?.some((run) => !isTerminal(run.status)) ?? false;
  return (
    <div className="design-preview dp-console rc-live">
      <div className="dp-shell">
        <aside className="dp-rail">
          <div className="dp-brand">
            <span className="dp-logo">↗</span>ReleaseCheck<span className="dp-brand-dot">.</span>
          </div>
          <div className="dp-workspace">
            <span className="dp-workspace-icon">N</span>
            <div>
              <strong>Northstar</strong>
              <small>Demo workspace</small>
            </div>
          </div>
          <section className="rc-run-controls">
            <h2>Run a demo check</h2>
            <label htmlFor="variant">Demo version</label>
            <select
              id="variant"
              value={variant}
              disabled={mutation.isPending}
              onChange={(event) => {
                setVariant(event.target.value as CreateRun['variant']);
                setKey(crypto.randomUUID());
                mutation.reset();
              }}
            >
              <option value="baseline">Original storefront</option>
              <option value="regression">Changed storefront with errors</option>
            </select>
            <button
              className="dp-summary-button"
              disabled={mutation.isPending || active || !history.data}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Starting…' : active ? 'Check in progress…' : 'Run check'}
            </button>
            {mutation.error && (
              <p role="alert" className="rc-warning">
                {mutation.error.message}
              </p>
            )}
          </section>
          <div className="dp-rail-divider" />
          <section className="rc-history">
            <h2>Recent checks</h2>
            {history.isPending && <p role="status">Loading history…</p>}
            {history.error && (
              <p role="alert">
                Cannot load checks. Confirm the local API and database are running.
              </p>
            )}
            {history.data?.length === 0 && <p>Your first check will appear here.</p>}
            {history.data?.map((run) => (
              <button
                key={run.id}
                aria-pressed={selected === run.id}
                onClick={() => setSelected(run.id)}
              >
                <span>
                  {run.id.slice(0, 8)}
                  <small>{new Date(run.createdAt).toLocaleString()}</small>
                </span>
                <span className={`rc-status ${run.status}`}>{run.status}</span>
              </button>
            ))}
          </section>
        </aside>
        <div className="dp-workspace-main">
          <div className="dp-topline">
            <span>
              Northstar <i>/</i> Checks
            </span>
            <span className="dp-environment">Local demo · Desktop</span>
          </div>
          {selected ? (
            <Report key={selected} id={selected} />
          ) : (
            <div className="rc-empty">
              <div className="dp-eyebrow">YOUR FIRST BASELINE</div>
              <h1>Know what changed.</h1>
              <p>
                Capture the original storefront, review it and save your baseline. Then check the
                changed version to see the visual difference and browser errors.
              </p>
              <p>One page. One viewport. Real browser evidence.</p>
            </div>
          )}
          <footer className="dp-page-footer">
            <span>Release Console</span>
            <span>Controlled demo storefront · Chromium · 1440 × 900</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
