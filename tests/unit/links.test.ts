import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkLinks } from '@releasecheck/checks';

const requests: string[] = [];
const server = createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`);
  if (req.url === '/redirect') res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }).end();
  else if (req.url === '/missing') res.writeHead(404).end();
  else if (req.url === '/unsupported') res.writeHead(405).end();
  else if (req.url === '/hang') {
    /* The client's deadline terminates this request. */
  } else res.writeHead(200).end();
});
let origin: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('deduplicates internal targets, skips external/fragment URLs and does not follow redirects', async () => {
  requests.length = 0;
  const result = await checkLinks(
    [
      '/ok',
      '/ok#section',
      '#section',
      'mailto:a@b.test',
      'http://127.0.0.1:1/private',
      '/missing',
      '/redirect',
      '/unsupported',
    ],
    `${origin}/`,
    origin,
  );
  expect(result.results.map((link) => [link.status, link.httpStatus])).toEqual([
    ['ok', 200],
    ['broken', 404],
    ['unverified', 302],
    ['unverified', 405],
  ]);
  expect(result.skipped).toBe(3);
  expect(requests).toEqual(['HEAD /ok', 'HEAD /missing', 'HEAD /redirect', 'HEAD /unsupported']);
});
it('caps unique requests and reports incomplete coverage', async () => {
  requests.length = 0;
  const result = await checkLinks(
    Array.from({ length: 25 }, (_, i) => `/page-${i}`),
    `${origin}/`,
    origin,
  );
  expect(result.results).toHaveLength(20);
  expect(requests).toHaveLength(20);
  expect(result.truncated).toBe(true);
});
it('turns request timeouts into unverified evidence', async () => {
  const result = await checkLinks(['/hang'], `${origin}/`, origin);
  expect(result.results).toEqual([{ url: `${origin}/hang`, status: 'unverified' }]);
});
