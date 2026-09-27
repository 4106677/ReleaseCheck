import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import './auth.css';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [logoutError, setLogoutError] = useState('');
  const session = useQuery({
    queryKey: ['session'],
    retry: false,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch('/api/auth/session');
      if (response.status === 401) return null;
      if (!response.ok)
        throw new Error('Cannot reach ReleaseCheck. Check the local API and try again.');
      return z
        .object({ userId: z.string(), mode: z.enum(['local', 'session']) })
        .parse(await response.json());
    },
  });
  if (session.data)
    return (
      <>
        {session.data.mode === 'session' && (
          <div className="auth-session">
            <span>Owner session</span>
            {logoutError && <span role="alert">{logoutError}</span>}
            <button
              onClick={async () => {
                try {
                  const response = await fetch('/api/auth/logout', { method: 'POST' });
                  if (response.ok || response.status === 401) location.replace('/');
                  else setLogoutError('Could not sign out. Try again.');
                } catch {
                  setLogoutError('Could not sign out. Try again.');
                }
              }}
            >
              Sign out
            </button>
          </div>
        )}
        {children}
      </>
    );
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">↗ ReleaseCheck</div>
        <p className="auth-eyebrow">RELEASE CONSOLE</p>
        <h1>
          Review your release
          <br />
          with confidence.
        </h1>
        <p>Compare screenshots, inspect browser errors and check internal links in one report.</p>
        {session.isPending ? (
          <p role="status">Checking your session…</p>
        ) : session.error ? (
          <>
            <p role="alert">{session.error.message}</p>
            <button onClick={() => void session.refetch()}>Try again</button>
          </>
        ) : (
          <>
            {new URLSearchParams(location.search).has('auth_error') && (
              <p role="alert">
                Sign-in could not be completed. Use the configured owner account and try again.
              </p>
            )}
            <a className="auth-login" href="/api/auth/github">
              Continue with GitHub
            </a>
            <p className="auth-note">
              Private demo workspace. Access is limited to its configured owner. Repository access
              is not requested.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
