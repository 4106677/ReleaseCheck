import type { CSSProperties } from 'react';
export type View = 'split' | 'before' | 'after' | 'diff';
export function ScreenshotViewer({
  view,
  position,
  onPosition,
  before,
  after,
  diff,
}: {
  before?: string | undefined;
  after: string;
  diff?: string | undefined;
  view: View;
  position: number;
  onPosition: (value: number) => void;
}) {
  return (
    <div className="dp-viewer">
      <div className="dp-browser-bar">
        <div className="dp-browser-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>northstar.demo /</span>
        <span className="dp-browser-size">1440 × 900</span>
      </div>
      <div
        className={`dp-capture ${view === 'split' ? 'dp-capture-split' : ''}`}
        style={{ '--position': `${position}%` } as CSSProperties}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (view !== 'split') return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          onPosition(
            Math.round(
              Math.max(5, Math.min(95, ((event.clientX - bounds.left) / bounds.width) * 100)),
            ),
          );
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          onPosition(
            Math.round(
              Math.max(5, Math.min(95, ((event.clientX - bounds.left) / bounds.width) * 100)),
            ),
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <img
          src={view === 'before' ? before : view === 'diff' ? diff : after}
          alt={
            view === 'diff'
              ? 'Real pixel difference, with changed pixels highlighted in coral'
              : view === 'before'
                ? 'Approved version of the demo storefront'
                : 'Current capture of the demo storefront'
          }
          width="1440"
          height="900"
        />
        {view === 'split' && (
          <>
            <img
              className="dp-before-overlay"
              src={before}
              alt="Baseline overlaid on the left of the comparison"
              width="1440"
              height="900"
            />
            <div className="dp-split-line" aria-hidden="true">
              <span>‹ ›</span>
            </div>
            <div className="dp-image-label dp-label-before">BASELINE</div>
            <div className="dp-image-label dp-label-after">CURRENT</div>
          </>
        )}
      </div>
      {view === 'split' && (
        <div className="dp-range">
          <label htmlFor="comparison-position">Drag to compare</label>
          <input
            id="comparison-position"
            aria-label="Comparison position"
            type="range"
            min="5"
            max="95"
            value={position}
            onChange={(event) => onPosition(Number(event.target.value))}
          />
          <span>{position}%</span>
        </div>
      )}
    </div>
  );
}
