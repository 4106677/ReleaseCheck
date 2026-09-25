import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './style.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const DesignPreview = lazy(() => import('./design/DesignPreview.js'));
const ReleaseConsole = lazy(() => import('./ReleaseConsole.js'));
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Suspense fallback={<p role="status">Loading ReleaseCheck…</p>}>
        {location.pathname === '/design' ? <DesignPreview /> : <ReleaseConsole />}
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
