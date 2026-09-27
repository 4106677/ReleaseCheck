import type { FastifyInstance } from 'fastify';
import type { Repository } from '@releasecheck/db';
import { z } from 'zod';
import { cookieValue, LOCAL_USER_ID } from './access.js';

export const oauthConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  ownerId: z.string().regex(/^[1-9][0-9]*$/),
  appOrigin: z.enum(['http://127.0.0.1:5173', 'http://localhost:5173']),
});
export type OAuthConfig = z.infer<typeof oauthConfigSchema>;
export type GithubIdentity = (
  code: string,
  verifier: string,
  config: OAuthConfig,
) => Promise<string>;
const callback = (config: OAuthConfig) => `${config.appOrigin}/api/auth/github/callback`;

export const githubIdentity: GithubIdentity = async (code, verifier, config) => {
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: callback(config),
    }),
  });
  if (!tokenResponse.ok) throw new Error('GitHub token exchange failed');
  const token = z
    .object({ access_token: z.string().min(1).max(2048) })
    .parse(await tokenResponse.json());
  const userResponse = await fetch('https://api.github.com/user', {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': 'ReleaseCheck',
    },
  });
  if (!userResponse.ok) throw new Error('GitHub identity check failed');
  return String(
    z.object({ id: z.number().int().positive().safe() }).parse(await userResponse.json()).id,
  );
};

export function installOAuth(
  app: FastifyInstance,
  repository: Repository,
  supplied: OAuthConfig,
  identity: GithubIdentity = githubIdentity,
) {
  const config = oauthConfigSchema.parse(supplied);
  app.get('/api/auth/github', async (_request, reply) => {
    const flow = await repository.beginOAuth();
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: callback(config),
      state: flow.state,
      code_challenge: flow.challenge,
      code_challenge_method: 'S256',
      scope: '',
      allow_signup: 'false',
    }).toString();
    reply.header(
      'Set-Cookie',
      `rc_oauth=${flow.browser}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
    return reply.redirect(url.href);
  });
  app.get('/api/auth/github/callback', async (request, reply) => {
    reply.header(
      'Set-Cookie',
      'rc_oauth=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0',
    );
    const query = z
      .object({ state: z.string().max(128), code: z.string().min(1).max(1024) })
      .safeParse(request.query);
    const fail = () => reply.redirect(`${config.appOrigin}/?auth_error=1`);
    if (!query.success) return fail();
    const verifier = await repository.consumeOAuth(
      query.data.state,
      cookieValue(request.headers.cookie, 'rc_oauth'),
    );
    if (!verifier) return fail();
    try {
      // This release has one controlled project. Never grant it to the first visitor.
      if ((await identity(query.data.code, verifier, config)) !== config.ownerId) return fail();
      const previous = cookieValue(request.headers.cookie, 'rc_session');
      if (previous) await repository.revokeSession(previous);
      const token = await repository.createSession(LOCAL_USER_ID);
      reply.header('Set-Cookie', [
        'rc_oauth=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0',
        `rc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      ]);
      return reply.redirect(`${config.appOrigin}/`);
    } catch {
      request.log.warn('GitHub sign-in failed');
      return fail();
    }
  });
}
