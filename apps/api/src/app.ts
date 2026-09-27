import Fastify from 'fastify';
import { installOAuth, type OAuthConfig, type GithubIdentity } from './oauth.js';
import { installAccess, type AccessMode } from './access.js';
import { startRecovery } from './recovery.js';
import {
  updateProjectSchema,
  approveBaselineSchema,
  createRunSchema,
  DEMO_PROJECT_ID,
  idempotencyKeySchema,
  runIdSchema,
} from '@releasecheck/contracts';
import { Conflict, type Repository } from '@releasecheck/db';
import type { LocalStorage } from '@releasecheck/storage';

export function buildApp(
  repository: Repository,
  storage: LocalStorage,
  fixtureOrigin: string,
  logger = false,
  accessMode: AccessMode = 'local',
  oauth?: OAuthConfig,
  identity?: GithubIdentity,
) {
  const app = Fastify({
    logger: logger
      ? {
          serializers: {
            req: (request) => ({ method: request.method, url: request.url.split('?')[0] ?? '' }),
          },
        }
      : false,
    bodyLimit: 8192,
  });
  let stopRecovery: (() => Promise<void>) | undefined;
  app.addHook('onReady', async () => {
    stopRecovery = startRecovery(repository, app.log);
  });
  app.addHook('preClose', async () => {
    await stopRecovery?.();
  });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0];
    if (!host || !['127.0.0.1', 'localhost'].includes(host)) {
      return reply
        .code(403)
        .send({ code: 'LOCAL_ONLY', message: 'Local requests only.', requestId: request.id });
    }
    const origin = request.headers.origin;
    if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) {
      return reply.code(403).send({
        code: 'ORIGIN_REJECTED',
        message: 'Origin is not allowed.',
        requestId: request.id,
      });
    }
  });
  installAccess(app, repository, accessMode);
  if (oauth && accessMode === 'session') installOAuth(app, repository, oauth, identity);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Conflict)
      return reply.code(409).send({
        code: error.code,
        message: {
          PROJECT_VERSION_CONFLICT:
            'Project settings changed. Reload the settings before saving again.',
          RUN_ACTIVE: 'A demo check is already queued or running.',
          IDEMPOTENCY_CONFLICT: 'This request key was already used with different settings.',
          BASELINE_VERSION_CONFLICT:
            'The baseline changed. Review the latest version before approving again.',
          CAPTURE_NOT_ELIGIBLE:
            'Only a completed capture with a recorded profile can become a baseline.',
        }[error.code],
        requestId: request.id,
      });
    request.log.error(error);
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    return reply.code(status).send({
      code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message: status === 500 ? 'The request could not be completed.' : 'Invalid request.',
      requestId: request.id,
    });
  });
  app.get('/api/health', async () => ({ status: 'ok', mode: 'local-demo' }));
  app.get('/api/projects', async (request) =>
    (await repository.ownsResource(request.userId!, 'projects', DEMO_PROJECT_ID))
      ? [await repository.getProject()]
      : [],
  );
  app.get('/api/projects/:id', async (request, reply) => {
    if ((request.params as { id: string }).id !== DEMO_PROJECT_ID)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Project not found.', requestId: request.id });
    return repository.getProject();
  });
  app.patch('/api/projects/:id', async (request, reply) => {
    if ((request.params as { id: string }).id !== DEMO_PROJECT_ID)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Project not found.', requestId: request.id });
    const input = updateProjectSchema.safeParse(request.body);
    if (!input.success)
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message:
          'Provide an expected settings version and tolerance between 0 and 500 basis points.',
        requestId: request.id,
      });
    return repository.updateProject(input.data);
  });
  app.post('/api/projects/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id !== DEMO_PROJECT_ID)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Project not found.', requestId: request.id });
    const input = createRunSchema.safeParse(request.body);
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
    if (!input.success || !key.success)
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message:
          'Choose a demo variant and provide an Idempotency-Key (8–128 letters, digits, underscores or hyphens).',
        requestId: request.id,
      });
    const result = await repository.createRun(input.data, key.data, fixtureOrigin);
    return reply
      .code(result.reused ? 200 : 202)
      .header('Location', `/api/runs/${result.id}`)
      .send(result);
  });
  app.get('/api/projects/:id/runs', async (request, reply) => {
    if ((request.params as { id: string }).id !== DEMO_PROJECT_ID)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Project not found.', requestId: request.id });
    return repository.listRuns();
  });
  app.get('/api/runs/:id', async (request, reply) => {
    const id = runIdSchema.safeParse((request.params as { id: string }).id);
    const result = id.success ? await repository.getRun(id.data) : null;
    if (!result)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Run not found.', requestId: request.id });
    return result;
  });
  app.get('/api/runs/:id/baseline', async (request, reply) => {
    const id = runIdSchema.safeParse((request.params as { id: string }).id);
    const result = id.success ? await repository.baselineForRun(id.data) : null;
    if (!result)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Run not found.', requestId: request.id });
    return result;
  });
  app.post('/api/projects/:id/baselines', async (request, reply) => {
    if ((request.params as { id: string }).id !== DEMO_PROJECT_ID)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Project not found.', requestId: request.id });
    const input = approveBaselineSchema.safeParse(request.body);
    if (!input.success)
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'Provide a run ID and expected baseline version.',
        requestId: request.id,
      });
    return repository.approveBaseline(input.data, request.userId!);
  });
  app.get('/api/artifacts/:id', async (request, reply) => {
    const id = runIdSchema.safeParse((request.params as { id: string }).id);
    const artifact = id.success ? await repository.artifact(id.data) : null;
    if (!artifact)
      return reply
        .code(404)
        .send({ code: 'NOT_FOUND', message: 'Artifact not found.', requestId: request.id });
    return reply
      .type('image/png')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await storage.read(artifact.key));
  });
  return app;
}
