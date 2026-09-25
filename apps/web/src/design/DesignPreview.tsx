import { useState } from 'react';
import metrics from './metrics.json';
import './design.css';

type Direction = 'studio' | 'console';
import { ScreenshotViewer, type View } from './ScreenshotViewer.js';
const views: { id: View; label: string }[] = [
  { id: 'split', label: 'Compare' },
  { id: 'before', label: 'Baseline' },
  { id: 'after', label: 'Current' },
  { id: 'diff', label: 'Difference' },
];
const percent = (metrics.diffRatio * 100).toFixed(2);
const issues = [
  {
    id: 'visual',
    type: 'VISUAL CHANGE',
    title: 'The primary action changed',
    detail: `${percent}% of pixels changed. The button is narrower, its label changed, and its color shifted.`,
    file: 'main > section > button',
    mark: '◈',
  },
  {
    id: 'javascript',
    type: 'JAVASCRIPT ERROR',
    title: 'Cart is unavailable',
    detail:
      'An unhandled error occurred when the page opened. The capture completed, but this issue needs investigation before release.',
    file: 'Demo regression: cart is unavailable',
    mark: '⌘',
  },
  {
    id: 'network',
    type: 'FAILED REQUEST',
    title: 'A resource returned 404',
    detail:
      'The page requested a resource that could not be found. Inspect the URL and check whether the release includes the expected file.',
    file: 'GET /missing-resource → 404',
    mark: '↗',
  },
] as const;

function Brand() {
  return (
    <div className="dp-brand">
      <span className="dp-logo" aria-hidden="true">
        ↗
      </span>
      ReleaseCheck<span className="dp-brand-dot">.</span>
    </div>
  );
}

export default function DesignPreview() {
  const initial =
    new URLSearchParams(location.search).get('direction') === 'studio' ? 'studio' : 'console';
  const [direction, setDirection] = useState<Direction>(initial);
  const [view, setView] = useState<View>('split');
  const [position, setPosition] = useState(58);
  const [issue, setIssue] = useState<(typeof issues)[number]>(issues[0]);
  const [summary, setSummary] = useState(false);
  function chooseDirection(next: Direction) {
    setDirection(next);
    history.replaceState(null, '', `/design?direction=${next}`);
  }
  return (
    <div className={`design-preview dp-${direction}`}>
      <div className="dp-prototype-bar">
        <span>
          <b>DESIGN REVIEW</b>
          <span className="dp-prototype-description">Two directions. One real comparison.</span>
        </span>
        <div className="dp-directions" aria-label="Design direction">
          <button aria-pressed={direction === 'studio'} onClick={() => chooseDirection('studio')}>
            A <span>Review Studio</span>
          </button>
          <button aria-pressed={direction === 'console'} onClick={() => chooseDirection('console')}>
            B <span>Release Console</span>
          </button>
        </div>
        <a href="/">Open working demo ↗</a>
      </div>
      <div className="dp-shell">
        <aside className="dp-rail">
          <Brand />
          <div className="dp-workspace">
            <span className="dp-workspace-icon">N</span>
            <div>
              <strong>Northstar</strong>
              <small>Demo workspace</small>
            </div>
            <span className="dp-chevron">⌄</span>
          </div>
          <div className="dp-nav-label">WORKSPACE</div>
          <div className="dp-nav-selected">
            <span>▦</span> Release review <span className="dp-nav-number">1</span>
          </div>
          <div className="dp-rail-divider" />
          <div className="dp-nav-label">THIS CHECK</div>
          <div className="dp-page-selected">
            <span>▧</span>
            <div>
              Homepage<small>/</small>
            </div>
            <span className="dp-warning-dot" />
          </div>
          <div className="dp-rail-context">
            <span className="dp-green-dot" />
            Capture finished<small>Chromium · Desktop</small>
          </div>
          <div className="dp-rail-footer">
            <span className="dp-avatar">YR</span>
            <div>
              Yaroslav<small>Personal workspace</small>
            </div>
            <span className="dp-local-badge">DEMO</span>
          </div>
        </aside>
        <div className="dp-workspace-main">
          <div className="dp-topline">
            <span>
              Northstar <i>/</i> Checks <i>/</i> <strong>RC–0184</strong>
            </span>
            <span className="dp-environment">
              <span />
              Preview environment
            </span>
          </div>
          <div className="dp-report-head">
            <div>
              <div className="dp-eyebrow">RELEASE READINESS</div>
              <h1>
                {direction === 'studio' ? 'A closer look before you ship.' : 'Release review'}
                <span className="dp-heading-dot">●</span>
              </h1>
              <p>Homepage changed. Review the visual update and two browser issues.</p>
            </div>
            <button className="dp-summary-button" onClick={() => setSummary(true)}>
              Review summary <span>↗</span>
            </button>
          </div>
          <div className="dp-overview">
            <div className="dp-result">
              <span className="dp-result-icon">!</span>
              <div>
                <strong>Needs attention</strong>
                <span>Capture completed · review required</span>
              </div>
            </div>
            <div className="dp-stat">
              <small>VISUAL CHANGE</small>
              <strong>
                {percent}
                <span>%</span>
              </strong>
            </div>
            <div className="dp-stat">
              <small>BROWSER ISSUES</small>
              <strong>
                02<span>issues</span>
              </strong>
            </div>
            <div className="dp-stat dp-profile">
              <small>CAPTURE PROFILE</small>
              <strong>
                Desktop<span>1440 × 900</span>
              </strong>
            </div>
          </div>
          <div className="dp-review-grid">
            <section className="dp-evidence" aria-label="Visual comparison">
              <div className="dp-evidence-head">
                <div>
                  <span className="dp-page-icon">▧</span>
                  <strong>Homepage</strong>
                  <code>/</code>
                </div>
                <span className="dp-change-pill">Visual change</span>
              </div>
              <div className="dp-view-controls">
                <div className="dp-tabs" aria-label="Screenshot view">
                  {views.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={view === item.id}
                      onClick={() => setView(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="dp-zoom">Fit to view</span>
              </div>
              <ScreenshotViewer
                before="/design/before.png"
                after="/design/after.png"
                diff="/design/diff.png"
                view={view}
                position={position}
                onPosition={setPosition}
              />
              <div className="dp-evidence-footer">
                <span>
                  <span className="dp-pixel-dot" />
                  {metrics.changedPixels.toLocaleString('en-US')} changed pixels
                </span>
                <span>Allowed difference {(metrics.maxDiffRatio * 100).toFixed(1)}%</span>
              </div>
            </section>
            <aside className="dp-issues" aria-label="Issues to review">
              <div className="dp-issues-header">
                <h2>Review queue</h2>
                <span>03</span>
              </div>
              <p className="dp-issues-description">Start with what could affect your users.</p>
              <div className="dp-issue-list">
                {issues.map((item, index) => (
                  <button
                    key={item.id}
                    className="dp-issue"
                    aria-pressed={issue.id === item.id}
                    onClick={() => {
                      setIssue(item);
                      if (item.id === 'visual') setView('diff');
                    }}
                  >
                    <span className="dp-issue-number">0{index + 1}</span>
                    <div>
                      <small>{item.type}</small>
                      <strong>{item.title}</strong>
                    </div>
                    <span className="dp-issue-arrow">↗</span>
                  </button>
                ))}
              </div>
              <div className="dp-issue-detail" aria-live="polite">
                <span className="dp-detail-mark">{issue.mark}</span>
                <h3>{issue.title}</h3>
                <p>{issue.detail}</p>
                <code>{issue.file}</code>
              </div>
              <div className="dp-review-note">
                <span>↳</span>
                <p>Accepting a visual change updates its baseline. Browser issues stay open.</p>
              </div>
            </aside>
          </div>
          <footer className="dp-page-footer">
            <span>Captured in a consistent browser environment.</span>
            <span>Design preview · sample report, no changes are saved</span>
          </footer>
        </div>
      </div>
      {summary && (
        <div
          className="dp-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSummary(false);
          }}
        >
          <dialog
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            aria-labelledby="summary-title"
            onCancel={() => setSummary(false)}
          >
            <button
              className="dp-dialog-close"
              aria-label="Close summary"
              autoFocus
              onClick={() => setSummary(false)}
            >
              ×
            </button>
            <div className="dp-eyebrow">CHECK RC–0184</div>
            <h2 id="summary-title">
              Ready for a review,
              <br />
              not a release.
            </h2>
            <p>
              The page was captured successfully. {percent}% of pixels changed, a JavaScript error
              occurred, and a resource returned 404.
            </p>
            <ul>
              <li>Inspect the button change before accepting a new baseline.</li>
              <li>Resolve the cart error and missing resource before shipping.</li>
            </ul>
            <p className="dp-dialog-note">
              This is a design prototype. Baseline approval is not connected and no release decision
              is saved.
            </p>
            <button className="dp-summary-button" onClick={() => setSummary(false)}>
              Back to comparison
            </button>
          </dialog>
        </div>
      )}
    </div>
  );
}
