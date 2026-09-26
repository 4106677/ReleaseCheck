import { useEffect, useSyncExternalStore, type MouseEvent } from 'react';
import { runIdSchema } from '@releasecheck/contracts';

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}
export function navigate(path: string) {
  if (location.pathname === path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function followLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigate(event.currentTarget.pathname);
}
export function useReportRoute() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  const match = /^\/runs\/([^/]+)\/?$/.exec(path);
  const id = runIdSchema.safeParse(match?.[1]);
  const title =
    path === '/'
      ? 'Checks · ReleaseCheck'
      : id.success
        ? `Check ${id.data.slice(0, 8)} · ReleaseCheck`
        : 'Page not found · ReleaseCheck';
  useEffect(() => {
    document.title = title;
  }, [title]);
  if (path === '/') return { kind: 'home' as const };
  return id.success ? { kind: 'run' as const, id: id.data } : { kind: 'not-found' as const };
}
