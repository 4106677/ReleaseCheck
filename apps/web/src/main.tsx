import { lazy, StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createdRunSchema,
  DEMO_PROJECT_ID,
  isTerminal,
  runHistorySchema,
  runSchema,
  type CreateRun,
} from '@releasecheck/contracts';
import './style.css';

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string')
        message = body.message;
    } catch {
      /* The API may be unavailable behind the development proxy. */
    }
    throw new Error(message);
  }
  return response.json();
}

function Report({ id }: { id: string }) {
  const {
    data: run,
    error,
    isPending,
  } = useQuery({
    queryKey: ['run', id],
    queryFn: async () => runSchema.parse(await request(`/runs/${id}`)),
    refetchInterval: (query) =>
      query.state.data && isTerminal(query.state.data.status) ? false : 2000,
    refetchIntervalInBackground: false,
  });
  if (error)
    return (
      <p role="alert" className="error">
        {error.message}
      </p>
    );
  if (isPending || !run) return <p role="status">Loading check…</p>;
  return (
    <section className="report" aria-label="Check result" data-run-id={run.id}>
      <div className="section-heading">
        <h2>Check result</h2>
        <div className="badges">
          {run.status === 'completed' && (
            <span className={`status ${run.verdict}`}>
              {run.verdict === 'attention' ? 'Needs attention' : 'Capture only'}
            </span>
          )}
          <span className={`status ${run.status}`}>{run.status}</span>
        </div>
      </div>
      <p className="meta">
        {run.variant === 'baseline' ? 'Original' : 'Changed'} demo · Desktop 1440 × 900 · Attempt{' '}
        {run.attempt}
      </p>
      {!isTerminal(run.status) && (
        <p role="status">
          {run.status === 'queued'
            ? 'Waiting for the worker…'
            : 'Opening the demo page and capturing the result…'}
        </p>
      )}
      {run.error && (
        <p role="alert" className="error">
          The check could not finish: {run.error}. No successful result is reported.
        </p>
      )}
      {run.capture && (
        <>
          <p className="notice">
            {run.capture.findings.length ? 'Findings need attention. ' : 'Capture completed. '}
            Visual comparison is not available yet; this result does not certify a release.
          </p>
          <a
            className="screenshot-link"
            href={`/api/artifacts/${run.capture.artifactId}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              className="screenshot"
              src={`/api/artifacts/${run.capture.artifactId}`}
              alt={`Captured ${run.variant === 'baseline' ? 'original' : 'changed'} demo storefront`}
              width="1440"
              height="900"
            />
            <span>Open full-size screenshot ↗</span>
          </a>
          <h3>
            Observed issues <span className="count">{run.capture.findings.length}</span>
          </h3>
          {run.capture.findings.length === 0 ? (
            <p className="meta">No JavaScript or network errors observed during this capture.</p>
          ) : (
            <ul className="findings">
              {run.capture.findings.map((finding, index) => (
                <li key={`${finding.kind}-${index}`}>
                  <strong>{finding.kind}</strong>
                  <p>{finding.message}</p>
                  {finding.url && <code>{finding.url}</code>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function App() {
  const queryClient = useQueryClient();
  const [variant, setVariant] = useState<CreateRun['variant']>('baseline');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['history'],
    queryFn: async () => {
      const data = await request(`/projects/${DEMO_PROJECT_ID}/runs`);
      return runHistorySchema.parse(data);
    },
    refetchInterval: (query) =>
      query.state.data?.some((run) => !isTerminal(run.status)) ? 2000 : false,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const data = await request(`/projects/${DEMO_PROJECT_ID}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ variant }),
      });
      return createdRunSchema.parse(data).id;
    },
    onSuccess: (id) => {
      setSelected(id);
      setKey(crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
  const active = history.data?.some((run) => !isTerminal(run.status)) ?? false;
  return (
    <main>
      <header>
        <div className="wordmark">
          ReleaseCheck<span className="preview">Local preview</span>
        </div>
        <p>Check what changed before you ship.</p>
      </header>
      <div className="notice">
        Explore the original and changed versions of the demo storefront. Each check captures the
        page and records browser errors. Visual comparison is coming next.
      </div>
      <div className="layout">
        <aside>
          <section>
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
            <p className="meta">
              The changed version alters the button and introduces a JavaScript error and a failed
              request.
            </p>
            <button
              className="primary"
              disabled={mutation.isPending || active}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Starting…' : active ? 'Check in progress…' : 'Run check'}
            </button>
            {mutation.error && (
              <p role="alert" className="error">
                {mutation.error.message}
              </p>
            )}
          </section>
          <section>
            <h2>Recent checks</h2>
            {history.isPending && <p role="status">Loading history…</p>}
            {history.error && (
              <p role="alert" className="error">
                Cannot load checks. Confirm the local API and database are running.
              </p>
            )}
            {history.data?.length === 0 && (
              <p className="meta">Your first check will appear here.</p>
            )}
            <ul className="history">
              {history.data?.map((run) => (
                <li key={run.id}>
                  <button aria-pressed={selected === run.id} onClick={() => setSelected(run.id)}>
                    <span>{new Date(run.createdAt).toLocaleTimeString()}</span>
                    <span className={`status ${run.status}`}>{run.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        {selected ? (
          <Report id={selected} />
        ) : (
          <section className="empty">
            <h2>See the result of a real check</h2>
            <p>
              Run the original storefront first, then the changed version. Select a check to inspect
              its screenshot and observed errors.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const DesignPreview = lazy(() => import('./design/DesignPreview.js'));
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      {location.pathname === '/design' ? (
        <Suspense fallback={<p role="status">Loading design preview…</p>}>
          <DesignPreview />
        </Suspense>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
