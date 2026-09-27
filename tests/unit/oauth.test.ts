import { afterEach, expect, it, vi } from 'vitest';
import { githubIdentity, oauthConfigSchema } from '../../apps/api/dist/oauth.js';
const config = {
  clientId: 'client',
  clientSecret: 'secret',
  ownerId: '123',
  appOrigin: 'http://127.0.0.1:5173' as const,
};
afterEach(() => vi.unstubAllGlobals());
it('exchanges the code server-side with PKCE and checks the authenticated GitHub identity', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 })));
  vi.stubGlobal('fetch', fetcher);
  expect(await githubIdentity('code', 'verifier', config)).toBe('123');
  expect(fetcher.mock.calls[0]![0]).toBe('https://github.com/login/oauth/access_token');
  const options = fetcher.mock.calls[0]![1] as RequestInit;
  expect(new URLSearchParams(String(options.body)).get('code_verifier')).toBe('verifier');
  expect(options.redirect).toBe('error');
  expect(fetcher.mock.calls[1]![0]).toBe('https://api.github.com/user');
  expect(fetcher.mock.calls[1]![1].headers.Authorization).toBe('Bearer test-token');
});
it('rejects provider errors and unsupported redirect origins', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })));
  await expect(githubIdentity('code', 'verifier', config)).rejects.toThrow();
  expect(
    oauthConfigSchema.safeParse({ ...config, appOrigin: 'https://attacker.example' }).success,
  ).toBe(false);
});
