import type { FastifyInstance } from 'fastify';
import type { Repository } from '@releasecheck/db';
import { runIdSchema } from '@releasecheck/contracts';

export type AccessMode = 'local' | 'session';
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000002';
declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

export function cookieValue(cookie: string | undefined, name: string) {
  const values = (cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
}

export function installAccess(app: FastifyInstance, repository: Repository, mode: AccessMode) {
  app.decorateRequest('userId', null);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const path = request.url.split('?')[0]!;
    if (
      path === '/api/health' ||
      path === '/api/auth/github' ||
      path === '/api/auth/github/callback'
    )
      return;
    const user =
      mode === 'local'
        ? { id: LOCAL_USER_ID, displayName: 'Local developer' }
        : await repository.sessionUser(cookieValue(request.headers.cookie, 'rc_session'));
    if (!user)
      return reply
        .code(401)
        .send({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.', requestId: request.id });
    request.userId = user.id;
    // Local browser origins are checked by the preceding host/origin guard.
    // Session mutations additionally require Origin, including logout.
    if (
      mode === 'session' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !request.headers.origin
    )
      return reply.code(403).send({
        code: 'ORIGIN_REQUIRED',
        message: 'A same-origin browser request is required.',
        requestId: request.id,
      });
    const match = /^\/api\/(projects|runs|artifacts)\/([^/]+)/.exec(path);
    if (match) {
      const id = runIdSchema.safeParse(match[2]);
      if (
        !id.success ||
        !(await repository.ownsResource(
          user.id,
          match[1] as 'projects' | 'runs' | 'artifacts',
          id.data,
        ))
      )
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', message: 'Resource not found.', requestId: request.id });
    }
  });
  app.get('/api/auth/session', async (request) => ({ userId: request.userId, mode }));
  app.post('/api/auth/logout', async (request, reply) => {
    if (mode === 'session')
      await repository.revokeSession(cookieValue(request.headers.cookie, 'rc_session'));
    reply.header('Set-Cookie', 'rc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { ok: true };
  });
}
